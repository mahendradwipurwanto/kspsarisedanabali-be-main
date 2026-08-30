import { Router } from 'express'
import { and, asc, desc, eq, ilike, isNull, sql, count } from 'drizzle-orm'
import { pageSchema, validateBlockProps, getBlock, scoreSeo, canPublish } from '@mahendradwipurwanto/ksp-contracts'
import { db, pages, pageBlocks, pageRevisions, users } from '../db/index.js'
import { asyncHandler, validate, requireAuth, requirePermission, notFound, ApiError, audit, validated, param } from '../middleware/index.js'
import { revalidateLp } from '../lib/revalidate.js'

export const pageRouter: Router = Router()
pageRouter.use(requireAuth)

type BlockInput = { id?: string; type: string; props: Record<string, unknown>; isVisible?: boolean }

/** Strip HTML and count words — used by the SEO scorer. */
const wordsIn = (html: string) => html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length

/**
 * Derive the SEO signals the scorer needs by walking the block list. The heading
 * level comes from the registry, never from the editor, so a page cannot end up
 * with two H1s regardless of what the user does in the UI.
 */
function analysePage(input: { title: string; slug: string; seo: Record<string, unknown>; blocks: BlockInput[] }) {
  let h1Count = 0
  let headingJumps = 0
  let wordCount = wordsIn(input.title)
  let imagesTotal = 0
  let imagesWithAlt = 0
  let internalLinks = 0
  let lastLevel = 1

  for (const b of input.blocks) {
    const def = getBlock(b.type)
    if (!def) continue
    if (def.headingLevel === 'h1') h1Count++
    if (def.headingLevel) {
      const level = Number(def.headingLevel.slice(1))
      if (level > lastLevel + 1) headingJumps++
      lastLevel = level
    }
    const walk = (v: unknown, key?: string) => {
      if (typeof v === 'string') {
        wordCount += wordsIn(v)
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
    if (updated!.status === 'published') await revalidateLp([`page:${updated!.slug}`])

    res.json({ data: updated })
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
    await revalidateLp([`page:${row.slug}`, 'sitemap'])
    res.json({ data: updated, seo })
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
    await revalidateLp([`page:${updated.slug}`, 'sitemap'])
    res.json({ data: updated })
  }),
)

pageRouter.delete(
  '/:id',
  requirePermission('pages:delete'),
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(pages).where(eq(pages.id, param(req, 'id'))).limit(1)
    if (!row) throw notFound('Halaman tidak ditemukan.')
    if (row.isSystem) throw new ApiError(400, 'Halaman sistem tidak bisa dihapus.', 'system_page')
    await db.update(pages).set({ deletedAt: new Date() }).where(eq(pages.id, row.id))
    await audit(req, { action: 'delete', entity: 'page', entityId: row.id, summary: row.title })
    res.json({ ok: true })
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
