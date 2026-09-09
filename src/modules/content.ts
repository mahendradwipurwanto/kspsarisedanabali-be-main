import { Router, type RequestHandler } from 'express'
import { and, asc, desc, eq, ilike, isNull, sql, count, type SQL } from 'drizzle-orm'
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core'
import { z, type ZodTypeAny } from 'zod'
import { productSchema, branchSchema, postSchema, jobSchema, slugSchema, updateJobApplicationSchema } from '../contracts/index.js'
import { db, products, branches, posts, postCategories, jobs, jobApplications, faqs, testimonials, documents, stats, settings, redirects, menus } from '../db/index.js'
import { asyncHandler, validate, requireAuth, requirePermission, notFound, forbidden, audit, validated, param } from '../middleware/index.js'
import { revalidateLp } from '../lib/revalidate.js'
import { presignDownload } from '../lib/storage.js'
import { invalidateSettingsCache } from './public.js'

/**
 * Generic CRUD factory. Every content type shares the same shape — list with
 * search + pagination, read, create, update, soft-or-hard delete — so the
 * per-type routers only declare what differs.
 */
interface CrudOptions {
  table: PgTable
  schema: ZodTypeAny
  permissions: { read: string[]; write: string[]; delete?: string[] }
  searchColumn?: PgColumn
  orderBy?: SQL | PgColumn
  softDelete?: boolean
  entity: string
  /** Cache tags to bust on the LP after a write. */
  tags?: (row: Record<string, unknown>) => string[]
}

/**
 * Drizzle's `from()` cannot prove an unresolved generic has a non-empty
 * selection, so this takes `PgTable` concretely rather than a type parameter —
 * every caller passes a real table, and the runtime behaviour is identical.
 */
function crud(opts: CrudOptions): Router {
  const r = Router()
  const t = opts.table as unknown as Record<string, PgColumn>
  const notDeleted = opts.softDelete ? isNull(t.deletedAt!) : undefined

  r.get(
    '/',
    requirePermission(...opts.permissions.read),
    asyncHandler(async (req, res) => {
      const q = validated<Record<string, string>>(req)
      const page = Math.max(Number(q.page ?? 1), 1)
      const limit = Math.min(Number(q.limit ?? 50), 200)
      const where = and(notDeleted, q.q && opts.searchColumn ? ilike(opts.searchColumn, `%${q.q}%`) : undefined)

      const [{ total }] = await db.select({ total: count() }).from(opts.table).where(where)
      const rows = await db
        .select()
        .from(opts.table)
        .where(where)
        .orderBy(opts.orderBy ?? desc(t.createdAt ?? t.id!))
        .limit(limit)
        .offset((page - 1) * limit)

      res.json({ data: rows, meta: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) } })
    }),
  )

  r.get(
    '/:id',
    requirePermission(...opts.permissions.read),
    asyncHandler(async (req, res) => {
      const [row] = await db.select().from(opts.table).where(and(eq(t.id!, param(req, 'id')), notDeleted)).limit(1)
      if (!row) throw notFound()
      res.json({ data: row })
    }),
  )

  r.post(
    '/',
    requirePermission(...opts.permissions.write),
    validate(opts.schema),
    asyncHandler(async (req, res) => {
      const [row] = await db.insert(opts.table).values(req.body as never).returning()
      await audit(req, { action: 'create', entity: opts.entity, entityId: (row as Record<string, string>).id })
      const refresh = await revalidateLp(opts.tags?.(row as Record<string, unknown>) ?? [opts.entity])
      res.status(201).json({ data: row, refreshed: refresh.ok, refreshError: refresh.reason })
    }),
  )

  r.patch(
    '/:id',
    requirePermission(...opts.permissions.write),
    validate((opts.schema as z.ZodObject<z.ZodRawShape>).partial()),
    asyncHandler(async (req, res) => {
      const [row] = await db
        .update(opts.table)
        .set({ ...(req.body as object), ...(t.updatedAt ? { updatedAt: new Date() } : {}) } as never)
        .where(and(eq(t.id!, param(req, 'id')), notDeleted))
        .returning()
      if (!row) throw notFound()
      await audit(req, { action: 'update', entity: opts.entity, entityId: param(req, 'id') })
      const refresh = await revalidateLp(opts.tags?.(row as Record<string, unknown>) ?? [opts.entity])
      res.json({ data: row, refreshed: refresh.ok, refreshError: refresh.reason })
    }),
  )

  r.delete(
    '/:id',
    requirePermission(...(opts.permissions.delete ?? opts.permissions.write)),
    asyncHandler(async (req, res) => {
      if (opts.softDelete) {
        const patch: Record<string, unknown> = { deletedAt: new Date() }
        // A soft-deleted row keeps its slug, and the slug is unique, so the
        // address could never be used again: an editor who deleted a product
        // and recreated it was told the slug was taken by a row they could no
        // longer see. Deleting releases it.
        if (t.slug) {
          const [row] = await db.select().from(opts.table).where(eq(t.id!, param(req, 'id'))).limit(1)
          const slug = (row as Record<string, unknown> | undefined)?.slug
          if (typeof slug === 'string') patch.slug = `${slug.slice(0, 90)}__dihapus__${Date.now()}`
        }
        await db.update(opts.table).set(patch as never).where(eq(t.id!, param(req, 'id')))
      } else await db.delete(opts.table).where(eq(t.id!, param(req, 'id')))
      await audit(req, { action: 'delete', entity: opts.entity, entityId: param(req, 'id') })
      const refresh = await revalidateLp([opts.entity])
      res.json({ ok: true, refreshed: refresh.ok, refreshError: refresh.reason })
    }),
  )

  return r
}

const guard: RequestHandler[] = [requireAuth]

/* ------------------------------- content routers ---------------------------- */

export const productRouter: Router = Router()
productRouter.use(guard)
productRouter.use(
  crud({
    table: products,
    schema: productSchema,
    permissions: { read: ['products:read'], write: ['products:write'], delete: ['products:delete'] },
    searchColumn: products.name,
    orderBy: asc(products.sortOrder),
    softDelete: true,
    entity: 'products',
    tags: (row) => ['products', `product:${row.slug as string}`],
  }),
)

export const branchRouter: Router = Router()
branchRouter.use(guard)
branchRouter.use(
  crud({
    table: branches,
    schema: branchSchema,
    permissions: { read: ['branches:read'], write: ['branches:write'] },
    searchColumn: branches.name,
    orderBy: asc(branches.sortOrder),
    entity: 'branches',
    tags: (row) => ['branches', `branch:${row.slug as string}`],
  }),
)

export const postRouter: Router = Router()
postRouter.use(guard)
postRouter.post(
  '/:id/publish',
  requirePermission('posts:publish'),
  asyncHandler(async (req, res) => {
    const [row] = await db
      .update(posts)
      .set({ status: 'published', publishedAt: sql`coalesce(${posts.publishedAt}, now())`, updatedAt: new Date() })
      .where(eq(posts.id, param(req, 'id')))
      .returning()
    if (!row) throw notFound('Berita tidak ditemukan.')
    await audit(req, { action: 'publish', entity: 'post', entityId: row.id, summary: row.title })
    await revalidateLp(['posts', `post:${row.slug}`, 'sitemap'])
    res.json({ data: row })
  }),
)
/**
 * The same guard the pages router applies: a status of "published" is the
 * publish permission's business, whichever route sets it.
 *
 * Without this the dedicated publish endpoint below was decorative — anyone
 * with `posts:write` could put a story on the website by changing the status
 * dropdown, which is exactly what the Kontributor role is meant not to do.
 * Unpublishing counts too: taking a story down is no smaller a decision.
 */
const guardPostPublish: RequestHandler = asyncHandler(async (req, _res, next) => {
  const status = (req.body as { status?: string } | undefined)?.status
  if (!status || req.auth!.permissions.includes('posts:publish')) return next()

  const id = (req.params as Record<string, string>).id
  const [existing] = id ? await db.select({ status: posts.status }).from(posts).where(eq(posts.id, id)).limit(1) : []
  const was = existing?.status ?? 'draft'
  if (status !== was && (status === 'published' || was === 'published')) {
    throw forbidden('Membutuhkan hak akses: posts:publish')
  }
  next()
})

postRouter.post('/', guardPostPublish)
postRouter.patch('/:id', guardPostPublish)
postRouter.use(
  crud({
    table: posts,
    schema: postSchema,
    permissions: { read: ['posts:read'], write: ['posts:write'], delete: ['posts:delete'] },
    searchColumn: posts.title,
    orderBy: desc(posts.createdAt),
    softDelete: true,
    entity: 'posts',
    tags: (row) => ['posts', `post:${row.slug as string}`],
  }),
)

export const postCategoryRouter: Router = Router()
postCategoryRouter.use(guard)
postCategoryRouter.use(
  crud({
    table: postCategories,
    // The slug goes into /berita?kategori=… so it has to be a slug: a free
    // string here accepted "kegiatan sosial", "Kegiatan-Sosial", even
    // "kegiatan/sosial", each of which breaks the address it ends up in.
    schema: z.object({ name: z.string().min(2).max(120), slug: slugSchema, description: z.string().optional() }),
    permissions: { read: ['posts:read'], write: ['posts:write'] },
    searchColumn: postCategories.name,
    orderBy: asc(postCategories.name),
    entity: 'post-categories',
  }),
)

export const jobRouter: Router = Router()
jobRouter.use(guard)

/**
 * Every application, newest first, whichever vacancy it answers.
 *
 * Registered before the crud router, whose `GET /:id` would otherwise read
 * "applications" as a job id. The per-job list below stays: it is what the
 * vacancy screen links to.
 *
 * A CV is personal data and is never included — the list carries only what is
 * needed to triage, and the file itself is fetched one at a time through the
 * signed-URL route, which leaves a trail.
 */
jobRouter.get(
  '/applications',
  requirePermission('jobs:applications'),
  asyncHandler(async (req, res) => {
    const q = validated<Record<string, string>>(req)
    const page = Math.max(Number(q.page ?? 1), 1)
    const limit = Math.min(Number(q.limit ?? 50), 200)

    const where = and(
      q.status ? eq(jobApplications.status, q.status) : undefined,
      q.jobId ? eq(jobApplications.jobId, q.jobId) : undefined,
    )

    const [{ total }] = await db.select({ total: count() }).from(jobApplications).where(where)
    const rows = await db
      .select({
        id: jobApplications.id, jobId: jobApplications.jobId, name: jobApplications.name,
        email: jobApplications.email, phone: jobApplications.phone, bio: jobApplications.bio,
        status: jobApplications.status, createdAt: jobApplications.createdAt,
        purgeAfter: jobApplications.purgeAfter, jobTitle: jobs.title,
      })
      .from(jobApplications)
      .leftJoin(jobs, eq(jobs.id, jobApplications.jobId))
      .where(where)
      .orderBy(desc(jobApplications.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    res.json({ data: rows, meta: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) } })
  }),
)

/** How many have not been looked at, for the badge on the menu. */
jobRouter.get(
  '/applications/summary',
  requirePermission('jobs:applications'),
  asyncHandler(async (_req, res) => {
    const rows = await db.select({ status: jobApplications.status, n: count() }).from(jobApplications).groupBy(jobApplications.status)
    res.json({
      data: {
        byStatus: Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])),
        total: rows.reduce((n, r) => n + Number(r.n), 0),
      },
    })
  }),
)

/**
 * The applicant's CV, as a link that stops working.
 *
 * CVs live under the private `cv/` prefix and are never proxied like an image,
 * so this mints a five-minute signature and records who asked for it. Reading
 * somebody's CV is the most sensitive thing this console does; it should leave
 * a trail, which a public URL never would.
 */
jobRouter.get(
  '/applications/:id/cv',
  requirePermission('jobs:applications'),
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(jobApplications).where(eq(jobApplications.id, param(req, 'id'))).limit(1)
    if (!row) throw notFound('Lamaran tidak ditemukan.')

    await audit(req, { action: 'read', entity: 'job-application', entityId: row.id, summary: `CV ${row.name} diunduh` })
    res.json({ data: { url: await presignDownload(row.cvKey, 300), expiresIn: 300 } })
  }),
)

jobRouter.patch(
  '/applications/:id',
  requirePermission('jobs:applications'),
  validate(updateJobApplicationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('zod').infer<typeof updateJobApplicationSchema>
    const [row] = await db
      .update(jobApplications)
      .set({ status: body.status })
      .where(eq(jobApplications.id, param(req, 'id')))
      .returning()
    if (!row) throw notFound('Lamaran tidak ditemukan.')

    await audit(req, { action: 'update', entity: 'job-application', entityId: row.id, summary: `${row.name} → ${body.status}` })
    res.json({ data: row })
  }),
)

jobRouter.get(
  '/:id/applications',
  requirePermission('jobs:applications'),
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(jobApplications)
      .where(eq(jobApplications.jobId, param(req, 'id')))
      .orderBy(desc(jobApplications.createdAt))
    res.json({ data: rows })
  }),
)
jobRouter.use(
  crud({
    table: jobs,
    schema: jobSchema,
    permissions: { read: ['jobs:read'], write: ['jobs:write'] },
    searchColumn: jobs.title,
    orderBy: desc(jobs.createdAt),
    entity: 'jobs',
    tags: (row) => ['jobs', `job:${row.slug as string}`],
  }),
)

export const faqRouter: Router = Router()
faqRouter.use(guard)
faqRouter.use(
  crud({
    table: faqs,
    schema: z.object({
      question: z.string().min(3),
      answer: z.string().min(3),
      category: z.string().max(60).optional(),
      sortOrder: z.number().int().default(0),
      isActive: z.boolean().default(true),
    }),
    permissions: { read: ['pages:read'], write: ['faqs:write'] },
    searchColumn: faqs.question,
    orderBy: asc(faqs.sortOrder),
    entity: 'faqs',
  }),
)

export const testimonialRouter: Router = Router()
testimonialRouter.use(guard)
testimonialRouter.use(
  crud({
    table: testimonials,
    schema: z.object({
      name: z.string().min(2).max(120),
      role: z.string().max(120).optional(),
      location: z.string().max(120).optional(),
      quote: z.string().min(5),
      rating: z.number().int().min(1).max(5).default(5),
      avatar: z.string().optional(),
      sortOrder: z.number().int().default(0),
      isActive: z.boolean().default(true),
    }),
    permissions: { read: ['pages:read'], write: ['testimonials:write'] },
    searchColumn: testimonials.name,
    orderBy: asc(testimonials.sortOrder),
    entity: 'testimonials',
  }),
)

export const documentRouter: Router = Router()
documentRouter.use(guard)
documentRouter.use(
  crud({
    table: documents,
    schema: z.object({
      title: z.string().min(2).max(250),
      category: z.enum(['laporan', 'legalitas', 'keuangan', 'lainnya']).default('laporan'),
      year: z.number().int().min(1990).max(2100).optional(),
      fileKey: z.string().min(1),
      fileSize: z.number().int().optional(),
      coverImage: z.string().optional().or(z.literal('')),
      isPublic: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
    }),
    permissions: { read: ['pages:read'], write: ['documents:write'] },
    searchColumn: documents.title,
    orderBy: desc(documents.year),
    entity: 'documents',
  }),
)

export const statRouter: Router = Router()
statRouter.use(guard)
statRouter.use(
  crud({
    table: stats,
    schema: z.object({
      label: z.string().min(1).max(60),
      value: z.string().min(1).max(40),
      icon: z.string().max(40).optional(),
      sortOrder: z.number().int().default(0),
      isActive: z.boolean().default(true),
    }),
    // `settings:manage` is still accepted so roles written before `stats:write`
    // existed keep working; new roles can be given the narrow one alone.
    permissions: { read: ['pages:read'], write: ['stats:write', 'settings:manage'] },
    searchColumn: stats.label,
    orderBy: asc(stats.sortOrder),
    entity: 'stats',
  }),
)

export const redirectRouter: Router = Router()
redirectRouter.use(guard)
redirectRouter.use(
  crud({
    table: redirects,
    schema: z.object({
      fromPath: z.string().min(1).max(500).startsWith('/', 'Harus diawali /'),
      toPath: z.string().min(1).max(500),
      statusCode: z.number().int().refine((v) => [301, 302, 308, 410].includes(v), 'Gunakan 301, 302, 308, atau 410').default(301),
      isActive: z.boolean().default(true),
      note: z.string().max(200).optional(),
    }),
    permissions: { read: ['redirects:manage'], write: ['redirects:manage'] },
    searchColumn: redirects.fromPath,
    orderBy: asc(redirects.fromPath),
    entity: 'redirects',
    tags: () => ['redirects'],
  }),
)

/* --------------------------------- settings -------------------------------- */

export const settingsRouter: Router = Router()
settingsRouter.use(guard)

settingsRouter.get(
  '/',
  requirePermission('settings:manage', 'pages:read'),
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(settings)
    res.json({ data: Object.fromEntries(rows.map((r) => [r.key, r.value])) })
  }),
)

settingsRouter.put(
  '/',
  requirePermission('settings:manage'),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>
    for (const [key, value] of Object.entries(body)) {
      await db
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
    }
    invalidateSettingsCache()
    await audit(req, { action: 'update', entity: 'settings', summary: Object.keys(body).join(', ') })
    const refresh = await revalidateLp(['settings'])
    res.json({ ok: true, refreshed: refresh.ok, refreshError: refresh.reason })
  }),
)

export const menuRouter: Router = Router()
menuRouter.use(guard)

menuRouter.get(
  '/:key',
  requirePermission('menus:manage', 'pages:read'),
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(menus).where(eq(menus.key, param(req, 'key'))).limit(1)
    res.json({ data: row ?? { key: param(req, 'key'), name: param(req, 'key'), items: [] } })
  }),
)

menuRouter.put(
  '/:key',
  requirePermission('menus:manage'),
  asyncHandler(async (req, res) => {
    const body = req.body as { name?: string; items: unknown[] }
    const [row] = await db
      .insert(menus)
      .values({ key: param(req, 'key'), name: body.name ?? param(req, 'key'), items: body.items })
      .onConflictDoUpdate({ target: menus.key, set: { items: body.items, updatedAt: new Date() } })
      .returning()
    const refresh = await revalidateLp(['menus'])
    res.json({ data: row, refreshed: refresh.ok, refreshError: refresh.reason })
  }),
)
