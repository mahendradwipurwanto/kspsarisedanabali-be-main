import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { and, asc, desc, eq, ilike, isNull, lt, sql, count } from 'drizzle-orm'
import { pageSchema, validateBlockProps, getBlock, scoreSeo, canPublish } from '../contracts/index.js'
import { db, pages, pageBlocks, pageRevisions, pagePreviews, users } from '../db/index.js'
import { asyncHandler, validate, requireAuth, requirePermission, notFound, forbidden, ApiError, audit, validated, param } from '../middleware/index.js'
import { revalidateLp } from '../lib/revalidate.js'
// Page writes revalidate the shared `pages` tag as well as the slug: the home
// page is stored as "/" but fetched by the site as "home", so a slug-only tag
// never matched it.

export const pageRouter: Router = Router()
pageRouter.use(requireAuth)

export type BlockInput = { id?: string; type: string; props: Record<string, unknown>; isVisible?: boolean }

/** Strip HTML and count words — used by the SEO scorer. */
const wordsIn = (html: string) => html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length

/**
 * Derive the SEO signals the scorer needs by walking the block list. The heading
 * level comes from the registry, never from the editor, so a page cannot end up
 * with two H1s regardless of what the user does in the UI.
 */
export function analysePage(input: { title: string; slug: string; seo: Record<string, unknown>; blocks: BlockInput[] }) {
  let h1Count = 0
  let headingJumps = 0
  let wordCount = wordsIn(input.title)
  let imagesTotal = 0
  let imagesWithAlt = 0
  let internalLinks = 0
  let lastLevel = 1
  // Collected so the focus-keyword checks can ask "is the phrase where Google
  // looks?" — the H1's own text, and everything a visitor actually reads.
  let h1Text = ''
  const bodyParts: string[] = [input.title]

  for (const b of input.blocks) {
    const def = getBlock(b.type)
    if (!def) continue
    if (def.headingLevel === 'h1') h1Count++
    if (def.headingLevel) {
      const level = Number(def.headingLevel.slice(1))
      if (level > lastLevel + 1) headingJumps++
      lastLevel = level
    }
    const isH1Block = def.headingLevel === 'h1'
    const walk = (v: unknown, key?: string) => {
      if (typeof v === 'string') {
        wordCount += wordsIn(v)
        bodyParts.push(v)
        if (isH1Block && (key === 'heading' || key === 'title')) h1Text += ` ${v}`
        if (key === 'image' || key === 'photo' || key === 'avatar') { if (v) imagesTotal++ }
        if (key === 'alt' || key === 'caption') { if (v.trim()) imagesWithAlt++ }
        if ((key === 'ctaHref' || key === 'href') && v.startsWith('/')) internalLinks++
        if (key === 'body' || key === 'content') internalLinks += (v.match(/href="\//g) ?? []).length
      } else if (Array.isArray(v)) v.forEach((x) => walk(x))
      else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) walk(val, k)
    }
    walk(b.props)
  }

  return scoreSeo({
    title: String(input.seo.metaTitle || input.title),
    description: String(input.seo.metaDescription ?? ''),
    slug: input.slug,
    h1Count,
    headingJumps,
    wordCount,
    imagesTotal,
    imagesWithAlt,
    internalLinks,
    focusKeyword: String(input.seo.focusKeyword ?? ''),
    h1Text: h1Text.trim() || input.title,
    // Strip markup so a keyword inside an attribute is not counted as body copy.
    bodyText: bodyParts.join(' ').replace(/<[^>]*>/g, ' '),
  })
}

function assertBlocksValid(blocks: BlockInput[]) {
  const seenSingletons = new Set<string>()
  for (const [i, b] of blocks.entries()) {
    const def = getBlock(b.type)
    if (!def) throw new ApiError(422, `Blok tidak dikenal: "${b.type}"`, 'unknown_block')
    if (def.singleton) {
      if (seenSingletons.has(b.type)) {
        throw new ApiError(422, `Blok "${def.label}" hanya boleh ada satu per halaman.`, 'duplicate_singleton')
      }
      seenSingletons.add(b.type)
    }
    const result = validateBlockProps(b.type, b.props)
    if (!result.success) throw new ApiError(422, `Blok ${i + 1} (${def.label}): ${result.error}`, 'invalid_block')
  }
}

pageRouter.get(
  '/',
  requirePermission('pages:read'),
  asyncHandler(async (req, res) => {
    const q = validated<Record<string, string>>(req)
    const page = Math.max(Number(q.page ?? 1), 1)
    const limit = Math.min(Number(q.limit ?? 30), 100)
    const where = and(
      isNull(pages.deletedAt),
      q.status ? eq(pages.status, q.status) : undefined,
      q.q ? ilike(pages.title, `%${q.q}%`) : undefined,
    )
    const [{ total }] = await db.select({ total: count() }).from(pages).where(where)
    const rows = await db
      .select({
        id: pages.id, title: pages.title, slug: pages.slug, status: pages.status,
        isSystem: pages.isSystem, publishedAt: pages.publishedAt, updatedAt: pages.updatedAt,
        updatedByName: users.name,
        blockCount: sql<number>`(select count(*)::int from page_blocks pb where pb.page_id = ${pages.id})`,
      })
      .from(pages)
      .leftJoin(users, eq(users.id, pages.updatedById))
      .where(where)
      .orderBy(desc(pages.updatedAt))
      .limit(limit)
      .offset((page - 1) * limit)

    res.json({ data: rows, meta: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) } })
  }),
)

pageRouter.get(
  '/:id',
  requirePermission('pages:read'),
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(pages).where(and(eq(pages.id, param(req, 'id')), isNull(pages.deletedAt))).limit(1)
    if (!row) throw notFound('Halaman tidak ditemukan.')
    const blocks = await db.select().from(pageBlocks).where(eq(pageBlocks.pageId, row.id)).orderBy(asc(pageBlocks.position))
    const seo = analysePage({ title: row.title, slug: row.slug, seo: row.seo, blocks: blocks as BlockInput[] })
    res.json({ data: { ...row, blocks }, seo })
  }),
)

pageRouter.post(
  '/',
  requirePermission('pages:create'),
  validate(pageSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('zod').infer<typeof pageSchema>
    assertBlocksValid(body.blocks)

    const [row] = await db
      .insert(pages)
      .values({
        title: body.title,
        slug: body.slug,
        status: 'draft',
        seo: body.seo,
        createdById: req.auth!.sub,
        updatedById: req.auth!.sub,
      })
      .returning()

    if (body.blocks.length) {
      await db.insert(pageBlocks).values(
        body.blocks.map((b, i) => ({ pageId: row!.id, type: b.type, props: b.props, position: i, isVisible: b.isVisible ?? true })),
      )
    }

    await audit(req, { action: 'create', entity: 'page', entityId: row!.id, summary: body.title })
    res.status(201).json({ data: row })
  }),
)

pageRouter.patch(
  '/:id',
  requirePermission('pages:update'),
  validate(pageSchema.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<import('zod').infer<typeof pageSchema>>
    const [existing] = await db.select().from(pages).where(and(eq(pages.id, param(req, 'id')), isNull(pages.deletedAt))).limit(1)
    if (!existing) throw notFound('Halaman tidak ditemukan.')

    if (body.slug && body.slug !== existing.slug && existing.isSystem) {
      throw new ApiError(400, 'Alamat halaman sistem tidak bisa diubah.', 'system_page')
    }

    /**
     * Publishing is a separate permission, so it has to be checked here too.
     *
     * `POST /:id/publish` asks for `pages:publish`, but this route accepted a
     * status of "published" on `pages:update` alone — which made the whole
     * permission decorative and let the Kontributor role, whose entire purpose
     * is writing drafts somebody else signs off, put a page on the website by
     * changing a dropdown. Withdrawing a published page is treated the same
     * way: taking the site down is no smaller a decision than putting it up.
     */
    if (body.status && body.status !== existing.status
        && (body.status === 'published' || existing.status === 'published')
        && !req.auth!.permissions.includes('pages:publish')) {
      throw forbidden('Membutuhkan hak akses: pages:publish')
    }

    if (body.blocks) assertBlocksValid(body.blocks)

    // Snapshot before mutating, so "kembalikan versi sebelumnya" always has a target.
    const currentBlocks = await db.select().from(pageBlocks).where(eq(pageBlocks.pageId, existing.id)).orderBy(asc(pageBlocks.position))
    await db.insert(pageRevisions).values({
      pageId: existing.id,
      snapshot: { page: existing, blocks: currentBlocks },
      createdById: req.auth!.sub,
    })

    const [updated] = await db
      .update(pages)
      .set({
        title: body.title ?? existing.title,
        slug: body.slug ?? existing.slug,
        seo: body.seo ?? existing.seo,
        status: body.status ?? existing.status,
        showInFooter: body.showInFooter ?? existing.showInFooter,
        updatedById: req.auth!.sub,
        updatedAt: new Date(),
      })
      .where(eq(pages.id, existing.id))
      .returning()

    if (body.blocks) {
      await db.delete(pageBlocks).where(eq(pageBlocks.pageId, existing.id))
      if (body.blocks.length) {
        await db.insert(pageBlocks).values(
          body.blocks.map((b, i) => ({ pageId: existing.id, type: b.type, props: b.props, position: i, isVisible: b.isVisible ?? true })),
        )
      }
    }

    await audit(req, { action: 'update', entity: 'page', entityId: existing.id, summary: updated!.title })
    const refresh = updated!.status === 'published'
      ? await revalidateLp(['pages', `page:${updated!.slug}`])
      : { ok: true }

    res.json({ data: updated, refreshed: refresh.ok, refreshError: 'reason' in refresh ? refresh.reason : undefined })
  }),
)

pageRouter.post(
  '/:id/publish',
  requirePermission('pages:publish'),
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(pages).where(and(eq(pages.id, param(req, 'id')), isNull(pages.deletedAt))).limit(1)
    if (!row) throw notFound('Halaman tidak ditemukan.')

    const blocks = await db.select().from(pageBlocks).where(eq(pageBlocks.pageId, row.id)).orderBy(asc(pageBlocks.position))
    const seo = analysePage({ title: row.title, slug: row.slug, seo: row.seo, blocks: blocks as BlockInput[] })
    const gate = canPublish(seo.checks)

    // The server enforces the same gate the CMS shows, so publishing cannot be
    // forced by calling the API directly.
    if (!gate.ok) {
      throw new ApiError(422, 'Halaman belum siap terbit. Perbaiki dulu poin berikut.', 'seo_gate', gate.blocking)
    }

    const [updated] = await db
      .update(pages)
      .set({ status: 'published', publishedAt: row.publishedAt ?? new Date(), updatedById: req.auth!.sub, updatedAt: new Date() })
      .where(eq(pages.id, row.id))
      .returning()

    await audit(req, { action: 'publish', entity: 'page', entityId: row.id, summary: row.title })
    const refresh = await revalidateLp(['pages', `page:${row.slug}`, 'sitemap'])
    res.json({ data: updated, seo, refreshed: refresh.ok, refreshError: refresh.reason })
  }),
)

pageRouter.post(
  '/:id/unpublish',
  requirePermission('pages:publish'),
  asyncHandler(async (req, res) => {
    const [updated] = await db
      .update(pages)
      .set({ status: 'draft', updatedById: req.auth!.sub, updatedAt: new Date() })
      .where(and(eq(pages.id, param(req, 'id')), eq(pages.isSystem, false)))
      .returning()
    if (!updated) throw notFound('Halaman tidak ditemukan atau tidak bisa ditarik.')
    const refresh = await revalidateLp(['pages', `page:${updated.slug}`, 'sitemap'])
    res.json({ data: updated, refreshed: refresh.ok, refreshError: refresh.reason })
  }),
)

pageRouter.delete(
  '/:id',
  requirePermission('pages:delete'),
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(pages).where(eq(pages.id, param(req, 'id'))).limit(1)
    if (!row) throw notFound('Halaman tidak ditemukan.')
    if (row.isSystem) throw new ApiError(400, 'Halaman sistem tidak bisa dihapus.', 'system_page')
    // The slug is released with the row: it stays unique in the database, so
    // keeping it would block ever creating that address again, and nothing can
    // restore a deleted page anyway.
    await db
      .update(pages)
      .set({ deletedAt: new Date(), slug: `${row.slug.slice(0, 90)}__dihapus__${Date.now()}` })
      .where(eq(pages.id, row.id))
    await audit(req, { action: 'delete', entity: 'page', entityId: row.id, summary: row.title })
    // Without this the deleted page stayed on the site, in the footer and in the
    // sitemap until its cache window expired.
    const refresh = await revalidateLp(['pages', `page:${row.slug}`, 'sitemap'])
    res.json({ ok: true, refreshed: refresh.ok, refreshError: refresh.reason })
  }),
)

pageRouter.get(
  '/:id/revisions',
  requirePermission('pages:read'),
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({ id: pageRevisions.id, note: pageRevisions.note, createdAt: pageRevisions.createdAt, authorName: users.name })
      .from(pageRevisions)
      .leftJoin(users, eq(users.id, pageRevisions.createdById))
      .where(eq(pageRevisions.pageId, param(req, 'id')))
      .orderBy(desc(pageRevisions.createdAt))
      .limit(30)
    res.json({ data: rows })
  }),
)

pageRouter.post(
  '/:id/revisions/:revisionId/restore',
  requirePermission('pages:update'),
  asyncHandler(async (req, res) => {
    const [rev] = await db
      .select()
      .from(pageRevisions)
      .where(and(eq(pageRevisions.id, param(req, 'revisionId')), eq(pageRevisions.pageId, param(req, 'id'))))
      .limit(1)
    if (!rev) throw notFound('Versi tidak ditemukan.')

    const snapshot = rev.snapshot as { page: typeof pages.$inferSelect; blocks: (typeof pageBlocks.$inferSelect)[] }

    await db
      .update(pages)
      .set({ title: snapshot.page.title, seo: snapshot.page.seo, updatedById: req.auth!.sub, updatedAt: new Date() })
      .where(eq(pages.id, param(req, 'id')))

    await db.delete(pageBlocks).where(eq(pageBlocks.pageId, param(req, 'id')))
    if (snapshot.blocks.length) {
      await db.insert(pageBlocks).values(
        snapshot.blocks.map((b, i) => ({ pageId: param(req, 'id'), type: b.type, props: b.props, position: i, isVisible: b.isVisible })),
      )
    }

    await audit(req, { action: 'restore', entity: 'page', entityId: param(req, 'id'), summary: `Versi ${rev.createdAt.toISOString()}` })
    res.json({ ok: true })
  }),
)

/** Live SEO scoring while editing — no save required. */
pageRouter.post(
  '/analyse',
  requirePermission('pages:read'),
  asyncHandler(async (req, res) => {
    const body = req.body as { title: string; slug: string; seo: Record<string, unknown>; blocks: BlockInput[] }
    res.json(analysePage({ title: body.title ?? '', slug: body.slug ?? '', seo: body.seo ?? {}, blocks: body.blocks ?? [] }))
  }),
)


/* --------------------------------- preview --------------------------------- */

/** How long a preview link stays valid. Long enough to look at, short enough
 *  that a link pasted into a chat stops working before it is forgotten. */
const PREVIEW_TTL_MINUTES = 30

/**
 * Snapshot the editor's current state — including unsaved changes — and hand
 * back a token the landing page can render.
 *
 * The alternative, previewing only what is saved, would make the preview
 * useless for the thing it is for: seeing a change before committing to it.
 */
pageRouter.post(
  '/:id/preview',
  requirePermission('pages:update'),
  asyncHandler(async (req, res) => {
    const body = req.body as { title: string; slug: string; seo: Record<string, unknown>; blocks: BlockInput[] }

    const [existing] = await db.select({ id: pages.id }).from(pages).where(eq(pages.id, param(req, 'id'))).limit(1)
    if (!existing) throw notFound('Halaman tidak ditemukan.')

    /**
     * Deliberately NOT assertBlocksValid.
     *
     * A preview exists to show work in progress, which is incomplete by
     * definition — refusing to render until every field passes would make it
     * useless exactly when it is wanted. It also rejected pages that are already
     * live: the seeded homepage has hero slides with no artwork yet, so
     * previewing the current site failed outright.
     *
     * Publishing is still gated (the PATCH and publish routes both validate), so
     * nothing invalid reaches visitors. Unknown block types are rejected here
     * because the renderer has nothing to render for them.
     */
    for (const b of body.blocks ?? []) {
      if (!getBlock(b.type)) throw new ApiError(422, `Blok tidak dikenal: "${b.type}"`, 'unknown_block')
    }

    // Swept here rather than on a schedule: Hobby plans get one cron a day, and
    // previews are created far more often than that.
    await db.delete(pagePreviews).where(lt(pagePreviews.expiresAt, new Date())).catch(() => {})

    const token = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MINUTES * 60_000)

    await db.insert(pagePreviews).values({
      token,
      pageId: existing.id,
      createdById: req.auth!.sub,
      expiresAt,
      snapshot: {
        title: body.title ?? '',
        slug: body.slug ?? '',
        seo: body.seo ?? {},
        blocks: (body.blocks ?? []).filter((b) => b.isVisible !== false),
      },
    })

    res.status(201).json({ data: { token, expiresAt: expiresAt.toISOString(), expiresInMinutes: PREVIEW_TTL_MINUTES } })
  }),
)
