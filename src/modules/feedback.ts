import { Router } from 'express'
import { and, count, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm'
import { publicFeedbackSchema, updateFeedbackSchema, normalisePhone } from '../contracts/index.js'
import { db, feedback, branches, users } from '../db/index.js'
import {
  asyncHandler, validate, requireAuth, requirePermission, notFound,
  ipRateLimit, audit, validated, param,
} from '../middleware/index.js'
import { hashIp } from '../lib/auth.js'

export const publicFeedbackRouter: Router = Router()
export const feedbackRouter: Router = Router()

/* ================================ PUBLIC INTAKE ============================== */

publicFeedbackRouter.post(
  '/feedback',
  // A suggestion box invites one message per visitor, not a stream; the cap is
  // tighter than the lead form's but still allows a family behind one carrier
  // NAT address to write in on the same afternoon.
  ipRateLimit(12, 300),
  validate(publicFeedbackSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('../contracts/index.js').PublicFeedback

    // Honeypot: answer as though it worked, store nothing.
    if (body.website) return res.status(201).json({ ok: true })

    const [row] = await db
      .insert(feedback)
      .values({
        category: body.category,
        rating: body.rating ?? null,
        name: body.name?.trim() || null,
        email: body.email || null,
        phone: body.phone ? normalisePhone(body.phone) : null,
        subject: body.subject?.trim() || null,
        message: body.message.trim(),
        branchId: body.branchId ?? null,
        sessionId: body.sessionId ?? null,
        referrer: String(req.headers.referer ?? '').slice(0, 500) || null,
        ipHash: req.clientIp ? hashIp(req.clientIp) : null,
      })
      .returning({ id: feedback.id })

    res.status(201).json({ ok: true, data: { id: row!.id } })
  }),
)

/* ================================== CONSOLE ================================== */

feedbackRouter.use(requireAuth)

feedbackRouter.get(
  '/',
  requirePermission('feedback:read'),
  asyncHandler(async (req, res) => {
    const q = validated<Record<string, string>>(req)
    const page = Math.max(Number(q.page ?? 1), 1)
    const limit = Math.min(Number(q.limit ?? 50), 100)

    const where = and(
      isNull(feedback.deletedAt),
      q.status ? eq(feedback.status, q.status) : undefined,
      q.category ? eq(feedback.category, q.category) : undefined,
      q.branchId ? eq(feedback.branchId, q.branchId) : undefined,
      q.from ? gte(feedback.createdAt, new Date(q.from)) : undefined,
      q.to ? lte(feedback.createdAt, new Date(q.to)) : undefined,
      q.q
        ? or(
            ilike(feedback.message, `%${q.q}%`),
            ilike(feedback.subject, `%${q.q}%`),
            ilike(feedback.name, `%${q.q}%`),
          )
        : undefined,
    )

    const [{ total }] = await db.select({ total: count() }).from(feedback).where(where)
    const rows = await db
      .select({ row: feedback, branchName: branches.name, handledByName: users.name })
      .from(feedback)
      .leftJoin(branches, eq(branches.id, feedback.branchId))
      .leftJoin(users, eq(users.id, feedback.handledById))
      .where(where)
      .orderBy(desc(feedback.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    res.json({
      data: rows.map((r) => ({ ...r.row, branchName: r.branchName, handledByName: r.handledByName })),
      meta: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
    })
  }),
)

/** Counts for the badge and the filter chips: one query, grouped by status. */
feedbackRouter.get(
  '/summary',
  requirePermission('feedback:read'),
  asyncHandler(async (_req, res) => {
    const scope = isNull(feedback.deletedAt)
    const [byStatus, [{ avg }]] = await Promise.all([
      db.select({ status: feedback.status, n: count() }).from(feedback).where(scope).groupBy(feedback.status),
      db
        .select({ avg: sql<number | null>`avg(${feedback.rating})::float` })
        .from(feedback)
        .where(and(scope, sql`${feedback.rating} is not null`)),
    ])

    res.json({
      data: {
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
        total: byStatus.reduce((n, r) => n + Number(r.n), 0),
        averageRating: avg == null ? null : Math.round(avg * 10) / 10,
      },
    })
  }),
)

feedbackRouter.patch(
  '/:id',
  requirePermission('feedback:update'),
  validate(updateFeedbackSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('zod').infer<typeof updateFeedbackSchema>
    const patch: Partial<typeof feedback.$inferInsert> = { updatedAt: new Date() }
    if (body.status !== undefined) {
      patch.status = body.status
      // Who dealt with it, and when — stamped the moment it stops being new.
      patch.handledById = req.auth!.sub
      patch.handledAt = new Date()
    }
    if (body.note !== undefined) patch.note = body.note || null

    const [row] = await db
      .update(feedback)
      .set(patch)
      .where(and(eq(feedback.id, param(req, 'id')), isNull(feedback.deletedAt)))
      .returning()
    if (!row) throw notFound('Masukan')

    await audit(req, { action: 'update', entity: 'feedback', entityId: row.id, summary: body.status ?? 'catatan' })
    res.json({ data: row })
  }),
)

feedbackRouter.delete(
  '/:id',
  requirePermission('feedback:delete'),
  asyncHandler(async (req, res) => {
    // Soft delete: a complaint someone removed in haste is still recoverable,
    // and the retention job clears it on the same schedule as the rest.
    const [row] = await db
      .update(feedback)
      .set({ deletedAt: new Date() })
      .where(and(eq(feedback.id, param(req, 'id')), isNull(feedback.deletedAt)))
      .returning({ id: feedback.id })
    if (!row) throw notFound('Masukan')

    await audit(req, { action: 'delete', entity: 'feedback', entityId: row.id, summary: 'Masukan dihapus' })
    res.json({ ok: true })
  }),
)
