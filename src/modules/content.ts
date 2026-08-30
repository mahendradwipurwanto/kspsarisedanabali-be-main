import { Router, type RequestHandler } from 'express'
import { and, asc, desc, eq, ilike, isNull, sql, count, type SQL } from 'drizzle-orm'
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core'
import { z, type ZodTypeAny } from 'zod'
import { productSchema, branchSchema, postSchema, jobSchema } from '@mahendradwipurwanto/ksp-contracts'
import { db, products, branches, posts, postCategories, jobs, jobApplications, faqs, testimonials, documents, stats, settings, redirects, menus } from '../db/index.js'
import { asyncHandler, validate, requireAuth, requirePermission, notFound, audit, validated, param } from '../middleware/index.js'
import { revalidateLp } from '../lib/revalidate.js'
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
      await revalidateLp(opts.tags?.(row as Record<string, unknown>) ?? [opts.entity])
      res.status(201).json({ data: row })
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
      await revalidateLp(opts.tags?.(row as Record<string, unknown>) ?? [opts.entity])
      res.json({ data: row })
    }),
  )

  r.delete(
    '/:id',
    requirePermission(...(opts.permissions.delete ?? opts.permissions.write)),
    asyncHandler(async (req, res) => {
      if (opts.softDelete) await db.update(opts.table).set({ deletedAt: new Date() } as never).where(eq(t.id!, param(req, 'id')))
      else await db.delete(opts.table).where(eq(t.id!, param(req, 'id')))
      await audit(req, { action: 'delete', entity: opts.entity, entityId: param(req, 'id') })
      await revalidateLp([opts.entity])
      res.json({ ok: true })
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
    schema: z.object({ name: z.string().min(2).max(120), slug: z.string().min(1).max(120), description: z.string().optional() }),
    permissions: { read: ['posts:read'], write: ['posts:write'] },
    searchColumn: postCategories.name,
    orderBy: asc(postCategories.name),
    entity: 'post-categories',
  }),
)

export const jobRouter: Router = Router()
jobRouter.use(guard)
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
    permissions: { read: ['pages:read'], write: ['settings:manage'] },
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
    await revalidateLp(['settings'])
    res.json({ ok: true })
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
    await revalidateLp(['menus'])
    res.json({ data: row })
  }),
)
