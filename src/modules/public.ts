import { Router } from 'express'
import { and, asc, desc, eq, isNull, isNotNull, lte, ne, or, sql, count } from 'drizzle-orm'
import { publicUrl, presignDownload } from '../lib/storage.js'
import { asyncHandler, notFound, param } from '../middleware/index.js'
import {
  db, pages, pageBlocks, products, branches, posts, postCategories, jobs, faqs,
  testimonials, documents, stats, settings, redirects, menus, media,
} from '../db/index.js'

export const publicRouter: Router = Router()

/** Public reads are cacheable; the CMS busts them by tag on publish. */
const cache = (res: Parameters<Parameters<Router['get']>[1]>[1], seconds = 300) => {
  res.setHeader('Cache-Control', `public, s-maxage=${seconds}, stale-while-revalidate=86400`)
}

const withImage = <T extends { image?: string | null }>(row: T) => ({ ...row, image: publicUrl(row.image ?? '') })

/**
 * Never emit an unverified rate as `ratePercent`. Blanking it at the API
 * boundary means no client — the site, a cached page, or anything built later —
 * can accidentally present an unconfirmed figure as the koperasi's published
 * terms.
 *
 * The recorded figure still ships, under a deliberately awkward name: it is what
 * the koperasi already publishes in its own brochures and on the old site, and
 * the installment calculator is useless without it. A consumer has to reach for
 * `*Indicative` on purpose, and the only one that does labels the result as an
 * unverified estimate. `isVerified` says which of the two is in play.
 */
const withRateGate = <T extends { isVerified?: boolean; ratePercent?: number | null; rateNote?: string | null; rateMethod?: string }>(row: T) => {
  const indicative = { ratePercentIndicative: row.ratePercent ?? null, rateMethodIndicative: row.rateMethod ?? 'none' }
  return row.isVerified
    ? { ...row, ...indicative }
    : { ...row, ...indicative, ratePercent: null, rateNote: null, rateMethod: 'none' }
}

const publishedFilter = (table: typeof pages | typeof posts) =>
  and(eq(table.status, 'published'), or(isNull(table.publishedAt), lte(table.publishedAt, new Date())), isNull(table.deletedAt))

/* ---------------------------------- pages ---------------------------------- */

publicRouter.get(
  '/pages/:slug',
  asyncHandler(async (req, res) => {
    const slug = param(req, 'slug') === 'home' ? '/' : param(req, 'slug')
    const [page] = await db.select().from(pages).where(and(eq(pages.slug, slug), publishedFilter(pages))).limit(1)
    if (!page) throw notFound('Halaman tidak ditemukan.')

    const blocks = await db
      .select()
      .from(pageBlocks)
      .where(and(eq(pageBlocks.pageId, page.id), eq(pageBlocks.isVisible, true)))
      .orderBy(asc(pageBlocks.position))

    cache(res)
    res.json({ data: { ...page, blocks } })
  }),
)

/* --------------------------------- products -------------------------------- */

publicRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    const category = String(req.query.category ?? '')
    const limit = Math.min(Number(req.query.limit ?? 50), 100)
    const where = and(
      eq(products.isActive, true),
      isNull(products.deletedAt),
      category && category !== 'all' ? eq(products.category, category) : undefined,
    )
    const rows = await db.select().from(products).where(where).orderBy(asc(products.sortOrder), asc(products.name)).limit(limit)
    cache(res)
    res.json({ data: rows.map((r) => withRateGate(withImage(r))) })
  }),
)

publicRouter.get(
  '/products/:slug',
  asyncHandler(async (req, res) => {
    const [row] = await db
      .select()
      .from(products)
      .where(and(eq(products.slug, param(req, 'slug')), eq(products.isActive, true), isNull(products.deletedAt)))
      .limit(1)
    if (!row) throw notFound('Produk tidak ditemukan.')

    const related = await db
      .select()
      .from(products)
      .where(and(eq(products.category, row.category), ne(products.id, row.id), eq(products.isActive, true), isNull(products.deletedAt)))
      .orderBy(asc(products.sortOrder))
      .limit(3)

    cache(res)
    res.json({ data: withRateGate(withImage(row)), related: related.map((r) => withRateGate(withImage(r))) })
  }),
)

/* --------------------------------- branches -------------------------------- */

publicRouter.get(
  '/branches',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.sortOrder))
    cache(res, 3600)
    res.json({ data: rows.map(withImage) })
  }),
)

publicRouter.get(
  '/branches/:slug',
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(branches).where(and(eq(branches.slug, param(req, 'slug')), eq(branches.isActive, true))).limit(1)
    if (!row) throw notFound('Kantor tidak ditemukan.')
    cache(res, 3600)
    res.json({ data: withImage(row) })
  }),
)

/* ----------------------------------- posts --------------------------------- */

publicRouter.get(
  '/posts',
  asyncHandler(async (req, res) => {
    const page = Math.max(Number(req.query.page ?? 1), 1)
    const limit = Math.min(Number(req.query.limit ?? 9), 50)
    const categorySlug = String(req.query.category ?? '')

    let categoryId: string | undefined
    if (categorySlug) {
      const [c] = await db.select({ id: postCategories.id }).from(postCategories).where(eq(postCategories.slug, categorySlug)).limit(1)
      categoryId = c?.id
      if (!categoryId) {
        cache(res)
        return res.json({ data: [], meta: { page, limit, total: 0, totalPages: 0 } })
      }
    }

    const where = and(publishedFilter(posts), categoryId ? eq(posts.categoryId, categoryId) : undefined)
    const [{ total }] = await db.select({ total: count() }).from(posts).where(where)

    const rows = await db
      .select({
        id: posts.id, title: posts.title, slug: posts.slug, excerpt: posts.excerpt,
        coverImage: posts.coverImage, publishedAt: posts.publishedAt, readMinutes: posts.readMinutes,
        categoryName: postCategories.name, categorySlug: postCategories.slug,
      })
      .from(posts)
      .leftJoin(postCategories, eq(postCategories.id, posts.categoryId))
      .where(where)
      .orderBy(desc(posts.publishedAt))
      .limit(limit)
      .offset((page - 1) * limit)

    cache(res)
    res.json({
      data: rows.map((r) => ({ ...r, coverImage: publicUrl(r.coverImage ?? '') })),
      meta: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
    })
  }),
)

publicRouter.get(
  '/posts/:slug',
  asyncHandler(async (req, res) => {
    const [row] = await db
      .select({
        post: posts,
        categoryName: postCategories.name,
        categorySlug: postCategories.slug,
      })
      .from(posts)
      .leftJoin(postCategories, eq(postCategories.id, posts.categoryId))
      .where(and(eq(posts.slug, param(req, 'slug')), publishedFilter(posts)))
      .limit(1)
    if (!row) throw notFound('Berita tidak ditemukan.')

    // The same shape the list endpoint returns: related items render with the
    // identical card, and omitting these left it printing "min baca" with no
    // number and no excerpt.
    const related = await db
      .select({
        id: posts.id, title: posts.title, slug: posts.slug, excerpt: posts.excerpt,
        coverImage: posts.coverImage, publishedAt: posts.publishedAt, readMinutes: posts.readMinutes,
        categoryName: postCategories.name, categorySlug: postCategories.slug,
      })
      .from(posts)
      .leftJoin(postCategories, eq(postCategories.id, posts.categoryId))
      .where(and(publishedFilter(posts), ne(posts.id, row.post.id)))
      .orderBy(desc(posts.publishedAt))
      .limit(3)

    // Fire-and-forget view counter; never blocks the response.
    void db.update(posts).set({ viewCount: sql`${posts.viewCount} + 1` }).where(eq(posts.id, row.post.id)).catch(() => {})

    cache(res)
    res.json({
      data: { ...row.post, coverImage: publicUrl(row.post.coverImage ?? ''), categoryName: row.categoryName, categorySlug: row.categorySlug },
      related: related.map((r) => ({ ...r, coverImage: publicUrl(r.coverImage ?? '') })),
    })
  }),
)

publicRouter.get(
  '/post-categories',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(postCategories).orderBy(asc(postCategories.name))
    cache(res, 3600)
    res.json({ data: rows })
  }),
)

/* ------------------------------------ jobs --------------------------------- */

publicRouter.get(
  '/jobs',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({ job: jobs, branchName: branches.name })
      .from(jobs)
      .leftJoin(branches, eq(branches.id, jobs.branchId))
      .where(eq(jobs.isActive, true))
      .orderBy(desc(jobs.createdAt))
    cache(res)
    res.json({ data: rows.map((r) => ({ ...r.job, branchName: r.branchName })) })
  }),
)

publicRouter.get(
  '/jobs/:slug',
  asyncHandler(async (req, res) => {
    const [row] = await db
      .select({ job: jobs, branchName: branches.name, branchAddress: branches.address })
      .from(jobs)
      .leftJoin(branches, eq(branches.id, jobs.branchId))
      .where(and(eq(jobs.slug, param(req, 'slug')), eq(jobs.isActive, true)))
      .limit(1)
    if (!row) throw notFound('Lowongan tidak ditemukan.')
    cache(res)
    res.json({ data: { ...row.job, branchName: row.branchName, branchAddress: row.branchAddress } })
  }),
)

/* ------------------------------- misc content ------------------------------ */

publicRouter.get(
  '/faqs',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(faqs).where(eq(faqs.isActive, true)).orderBy(asc(faqs.sortOrder))
    cache(res, 3600)
    res.json({ data: rows })
  }),
)

publicRouter.get(
  '/testimonials',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 12), 50)
    const rows = await db.select().from(testimonials).where(eq(testimonials.isActive, true)).orderBy(asc(testimonials.sortOrder)).limit(limit)
    cache(res, 3600)
    res.json({ data: rows.map((r) => ({ ...r, avatar: publicUrl(r.avatar ?? '') })) })
  }),
)

publicRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(stats).where(eq(stats.isActive, true)).orderBy(asc(stats.sortOrder))
    cache(res, 3600)
    res.json({ data: rows })
  }),
)

publicRouter.get(
  '/documents',
  asyncHandler(async (req, res) => {
    const category = String(req.query.category ?? '')
    const rows = await db
      .select()
      .from(documents)
      .where(and(eq(documents.isPublic, true), category ? eq(documents.category, category) : undefined))
      .orderBy(desc(documents.year), asc(documents.sortOrder))
    cache(res, 3600)
    res.json({ data: rows.map((r) => ({ ...r, url: publicUrl(r.fileKey) })) })
  }),
)

/**
 * Settings are read by the header, the footer, and the SEO helpers, so every
 * page in the site asks for them. `next build` renders across seven worker
 * processes that cannot share a fetch cache, which turned one small key-value
 * table into the heaviest query on the shared cluster and pushed whole builds
 * past the response deadline.
 *
 * A short in-process cache fixes that without weakening anything: the table is a
 * handful of rows that change when a staff member edits them, and 30 seconds is
 * far inside the CDN's own 600s freshness window.
 */
let settingsCache: { at: number; data: Record<string, unknown> } | null = null
const SETTINGS_TTL_MS = 30_000

/** Called by the CMS write path so an edit is live immediately, not in 30s. */
export const invalidateSettingsCache = () => { settingsCache = null }

publicRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    if (!settingsCache || Date.now() - settingsCache.at > SETTINGS_TTL_MS) {
      const rows = await db.select().from(settings)
      settingsCache = { at: Date.now(), data: Object.fromEntries(rows.map((r) => [r.key, r.value])) }
    }
    cache(res, 600)
    res.json({ data: settingsCache.data })
  }),
)

publicRouter.get(
  '/menus/:key',
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(menus).where(eq(menus.key, param(req, 'key'))).limit(1)
    cache(res, 3600)
    res.json({ data: row?.items ?? [] })
  }),
)

/* -------------------------- SEO infrastructure feeds ------------------------ */

publicRouter.get(
  '/sitemap-data',
  asyncHandler(async (_req, res) => {
    const [pageRows, productRows, postRows, branchRows, jobRows] = await Promise.all([
      db.select({ slug: pages.slug, updatedAt: pages.updatedAt }).from(pages).where(publishedFilter(pages)),
      db.select({ slug: products.slug, category: products.category, updatedAt: products.updatedAt }).from(products).where(and(eq(products.isActive, true), isNull(products.deletedAt))),
      db.select({ slug: posts.slug, updatedAt: posts.updatedAt }).from(posts).where(publishedFilter(posts)),
      db.select({ slug: branches.slug, updatedAt: branches.updatedAt }).from(branches).where(eq(branches.isActive, true)),
      db.select({ slug: jobs.slug, updatedAt: jobs.updatedAt }).from(jobs).where(eq(jobs.isActive, true)),
    ])
    cache(res, 600)
    res.json({ data: { pages: pageRows, products: productRows, posts: postRows, branches: branchRows, jobs: jobRows } })
  }),
)

publicRouter.get(
  '/redirects',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({ fromPath: redirects.fromPath, toPath: redirects.toPath, statusCode: redirects.statusCode })
      .from(redirects)
      .where(eq(redirects.isActive, true))
    cache(res, 3600)
    res.json({ data: rows })
  }),
)

/** Everything the homepage needs, in one round trip — avoids an N+1 waterfall on ISR. */
publicRouter.get(
  '/bootstrap',
  asyncHandler(async (_req, res) => {
    const [branchRows, statRows, settingRows] = await Promise.all([
      db.select().from(branches).where(eq(branches.isActive, true)).orderBy(asc(branches.sortOrder)),
      db.select().from(stats).where(eq(stats.isActive, true)).orderBy(asc(stats.sortOrder)),
      db.select().from(settings),
    ])
    cache(res, 600)
    res.json({
      data: {
        branches: branchRows.map(withImage),
        stats: statRows,
        settings: Object.fromEntries(settingRows.map((r) => [r.key, r.value])),
      },
    })
  }),
)

publicRouter.get(
  '/documents/:id/url',
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(documents).where(eq(documents.id, param(req, 'id'))).limit(1)
    if (!row || !row.isPublic) throw notFound('Dokumen tidak ditemukan.')
    res.json({ data: { url: publicUrl(row.fileKey), title: row.title } })
  }),
)

/**
 * Signed URL for a public-prefix object, used by the LP's image proxy while the
 * bucket has no public-read policy. Private prefixes are refused outright.
 */
publicRouter.get(
  '/media-url',
  asyncHandler(async (req, res) => {
    const key = String(req.query.key ?? '')
    if (!key || key.startsWith('cv/') || key.includes('..')) throw notFound('Berkas tidak ditemukan.')

    const [row] = await db.select({ id: media.id }).from(media).where(eq(media.key, key)).limit(1)
    if (!row) throw notFound('Berkas tidak ditemukan.')

    // 10-minute signature; the LP caches the bytes for a year since keys are immutable.
    res.setHeader('Cache-Control', 'public, s-maxage=240')
    res.json({ data: { url: await presignDownload(key, 600) } })
  }),
)

publicRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ksp-api', time: new Date().toISOString() })
})

/** Kept for the "did the DB actually answer?" check in deploy smoke tests. */
publicRouter.get(
  '/health/db',
  asyncHandler(async (_req, res) => {
    const started = Date.now()
    const [row] = await db.select({ n: sql<number>`1::int` }).from(settings).limit(1).catch(() => [{ n: 0 }])
    res.json({ ok: true, latencyMs: Date.now() - started, reachable: row !== undefined })
  }),
)
