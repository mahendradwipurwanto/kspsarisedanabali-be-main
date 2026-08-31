import { Router } from 'express'
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, count } from 'drizzle-orm'
import {
  publicLeadSchema, updateLeadSchema, profilingSessionSchema, normalisePhone,
  calculateInstallment, jobApplicationSchema, type RateMethod,
} from '../contracts/index.js'
import { db, leads, leadEvents, products, branches, users, profilingSessions, jobApplications, jobs } from '../db/index.js'
import {
  asyncHandler, validate, requireAuth, requirePermission, forbidden, notFound,
  ipRateLimit, audit, ApiError, validated, param
} from '../middleware/index.js'
import { hashIp } from '../lib/auth.js'
import { presignUpload } from '../lib/storage.js'
import { env } from '../lib/env.js'
import { recommendProduct } from './recommend.js'

export const publicLeadRouter: Router = Router()
export const leadRouter: Router = Router()

async function verifyTurnstile(token: string | undefined, ip: string | undefined): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true // not configured yet — allowed in development
  if (!token) return false
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    })
    const json = (await r.json()) as { success?: boolean }
    return Boolean(json.success)
  } catch {
    return false
  }
}

/* ================================ PUBLIC INTAKE ============================== */

publicLeadRouter.post(
  '/leads',
  /**
   * Deliberately generous. Most Indonesian mobile traffic sits behind
   * carrier-grade NAT, so many genuine prospects share one public IP — a tight
   * per-IP cap would turn a busy afternoon into rejected leads. The honeypot and
   * Turnstile are the real bot defence; this is only a burst backstop.
   */
  ipRateLimit(30, 300),
  validate(publicLeadSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('../contracts/index.js').PublicLead

    // Honeypot: real users never fill a hidden field.
    if (body.website) return res.status(201).json({ ok: true })
    if (!(await verifyTurnstile(body.turnstileToken, req.clientIp))) {
      throw new ApiError(400, 'Verifikasi keamanan gagal. Silakan muat ulang halaman.', 'captcha_failed')
    }

    const phone = normalisePhone(body.phone)

    // Estimate the installment server-side so the stored figure cannot be tampered with.
    let estimatedInstallment: number | null = null
    if (body.productId && body.amount && body.tenorMonths) {
      const [product] = await db.select().from(products).where(eq(products.id, body.productId)).limit(1)
      if (product?.ratePercent != null) {
        estimatedInstallment = calculateInstallment({
          principal: body.amount,
          annualRatePercent: product.ratePercent,
          months: body.tenorMonths,
          method: product.rateMethod as RateMethod,
        }).monthly
      }
    }

    const [lead] = await db
      .insert(leads)
      .values({
        name: body.name.trim(),
        phone,
        email: body.email || null,
        interest: body.interest ?? null,
        productId: body.productId ?? null,
        branchId: body.branchId ?? null,
        message: body.message || null,
        amount: body.amount ?? null,
        tenorMonths: body.tenorMonths ?? null,
        purposes: body.purposes ?? [],
        estimatedInstallment,
        source: body.source,
        sessionId: body.sessionId ?? null,
        referrer: String(req.headers.referer ?? '').slice(0, 500) || null,
        ipHash: req.clientIp ? hashIp(req.clientIp) : null,
      })
      .returning()

    await db.insert(leadEvents).values({ leadId: lead!.id, type: 'status_change', toValue: 'baru', note: 'Masuk dari website' })

    if (body.sessionId) {
      await db
        .update(profilingSessions)
        .set({ leadId: lead!.id, completedAt: new Date(), updatedAt: new Date() })
        .where(eq(profilingSessions.sessionId, body.sessionId))
    }

    res.status(201).json({ ok: true, data: { id: lead!.id } })
  }),
)

/* ------------------------------ profiling wizard ---------------------------- */

publicLeadRouter.post(
  '/profiling/session',
  ipRateLimit(60, 300),
  validate(profilingSessionSchema),
  asyncHandler(async (req, res) => {
    const { sessionId, step, answers } = req.body as { sessionId: string; step: number; answers: Record<string, unknown> }

    // Partial answers are persisted at every step, so an abandoned wizard still
    // yields funnel data even though it never becomes a lead.
    const [row] = await db
      .insert(profilingSessions)
      .values({ sessionId, step, answers })
      .onConflictDoUpdate({ target: profilingSessions.sessionId, set: { step, answers, updatedAt: new Date() } })
      .returning()

    res.json({ ok: true, data: { id: row!.id, step: row!.step } })
  }),
)

publicLeadRouter.post(
  '/profiling/recommend',
  ipRateLimit(30, 300),
  asyncHandler(async (req, res) => {
    const { need, purposes, amount, tenorMonths, sessionId } = req.body as {
      need?: 'pinjaman' | 'simpanan'
      purposes?: string[]
      amount?: number
      tenorMonths?: number
      sessionId?: string
    }

    const candidates = await db
      .select()
      .from(products)
      .where(and(eq(products.isActive, true), isNull(products.deletedAt), need ? eq(products.category, need) : undefined))
      .orderBy(asc(products.sortOrder))

    const result = recommendProduct(candidates, { need, purposes, amount, tenorMonths })
    if (!result.best) throw notFound('Belum ada produk yang cocok. Silakan hubungi kami langsung.')

    if (sessionId) {
      await db
        .update(profilingSessions)
        .set({ recommendedProductId: result.best.product.id, matchScore: result.best.score, updatedAt: new Date() })
        .where(eq(profilingSessions.sessionId, sessionId))
        .catch(() => {})
    }

    res.json({ data: result })
  }),
)

/* --------------------------- career applications --------------------------- */

/**
 * Unauthenticated presign, deliberately narrow: `cv/` prefix only, PDF/DOC only,
 * 5 MB cap, and rate limited. Applicants must be able to upload without an
 * account, but nothing else in the bucket is reachable this way.
 */
publicLeadRouter.post(
  '/job-applications/presign',
  ipRateLimit(8, 600),
  asyncHandler(async (req, res) => {
    const body = req.body as { filename?: string; contentType?: string; size?: number }
    if (!body.filename || !body.contentType || !body.size) throw new ApiError(422, 'Data berkas tidak lengkap.', 'validation_error')
    if (body.size > 5 * 1024 * 1024) throw new ApiError(422, 'Ukuran CV maksimal 5 MB.', 'file_too_large')

    const presigned = await presignUpload({
      folder: 'cv',
      filename: body.filename,
      contentType: body.contentType,
      size: body.size,
    })
    res.json({ data: presigned })
  }),
)

publicLeadRouter.post(
  '/job-applications',
  ipRateLimit(5, 600),
  validate(jobApplicationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('zod').infer<typeof jobApplicationSchema>
    if (body.website) return res.status(201).json({ ok: true })

    const [job] = await db.select().from(jobs).where(and(eq(jobs.id, body.jobId), eq(jobs.isActive, true))).limit(1)
    if (!job) throw notFound('Lowongan tidak ditemukan atau sudah ditutup.')

    // CVs are personal data. Retention: 12 months, enforced by the purge cron.
    const purgeAfter = new Date(Date.now() + 365 * 86_400_000)

    await db.insert(jobApplications).values({
      jobId: body.jobId,
      name: body.name.trim(),
      email: body.email,
      phone: normalisePhone(body.phone),
      bio: body.bio || null,
      cvKey: body.cvKey,
      purgeAfter,
    })

    res.status(201).json({ ok: true })
  }),
)

/* =============================== ADMIN SURFACE =============================== */

/**
 * Branch scoping. A user holding only `leads:read:branch` may read leads whose
 * branch is in their assignment list. This is a query-level filter, not a UI one.
 */
function branchScope(auth: { permissions: string[]; branchIds: string[] }) {
  if (auth.permissions.includes('leads:read:all')) return undefined
  if (!auth.permissions.includes('leads:read:branch')) throw forbidden()
  if (auth.branchIds.length === 0) {
    // Assigned to no branch — must match nothing rather than everything.
    return sql`false`
  }
  return inArray(leads.branchId, auth.branchIds)
}

leadRouter.use(requireAuth)

leadRouter.get(
  '/',
  requirePermission('leads:read:all', 'leads:read:branch'),
  asyncHandler(async (req, res) => {
    const q = validated<Record<string, string>>(req)
    const page = Math.max(Number(q.page ?? 1), 1)
    const limit = Math.min(Number(q.limit ?? 25), 100)

    const where = and(
      isNull(leads.deletedAt),
      branchScope(req.auth!),
      q.status ? eq(leads.status, q.status) : undefined,
      q.source ? eq(leads.source, q.source) : undefined,
      q.branchId ? eq(leads.branchId, q.branchId) : undefined,
      q.from ? gte(leads.createdAt, new Date(q.from)) : undefined,
      q.to ? lte(leads.createdAt, new Date(q.to)) : undefined,
      q.q ? or(ilike(leads.name, `%${q.q}%`), ilike(leads.phone, `%${q.q}%`)) : undefined,
    )

    const [{ total }] = await db.select({ total: count() }).from(leads).where(where)
    const rows = await db
      .select({
        lead: leads,
        productName: products.name,
        branchName: branches.name,
        assignedToName: users.name,
      })
      .from(leads)
      .leftJoin(products, eq(products.id, leads.productId))
      .leftJoin(branches, eq(branches.id, leads.branchId))
      .leftJoin(users, eq(users.id, leads.assignedToId))
      .where(where)
      .orderBy(desc(leads.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    res.json({
      data: rows.map((r) => ({ ...r.lead, productName: r.productName, branchName: r.branchName, assignedToName: r.assignedToName })),
      meta: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
    })
  }),
)

leadRouter.get(
  '/summary',
  requirePermission('leads:read:all', 'leads:read:branch'),
  asyncHandler(async (req, res) => {
    const scope = and(isNull(leads.deletedAt), branchScope(req.auth!))
    const since24h = new Date(Date.now() - 86_400_000)

    const [byStatus, [{ untouched }], [{ today }]] = await Promise.all([
      db.select({ status: leads.status, n: count() }).from(leads).where(scope).groupBy(leads.status),
      db
        .select({ untouched: count() })
        .from(leads)
        .where(and(scope, eq(leads.status, 'baru'), lte(leads.createdAt, since24h))),
      db
        .select({ today: count() })
        .from(leads)
        .where(and(scope, gte(leads.createdAt, new Date(new Date().setHours(0, 0, 0, 0))))),
    ])

    res.json({
      data: {
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
        /** Leads still "baru" after 24 hours — the number the dashboard turns red. */
        untouchedOver24h: Number(untouched),
        today: Number(today),
      },
    })
  }),
)

leadRouter.get(
  '/:id',
  requirePermission('leads:read:all', 'leads:read:branch'),
  asyncHandler(async (req, res) => {
    const [row] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, param(req, 'id')), isNull(leads.deletedAt), branchScope(req.auth!)))
      .limit(1)
    if (!row) throw notFound('Data calon nasabah tidak ditemukan.')

    const timeline = await db
      .select({ event: leadEvents, userName: users.name })
      .from(leadEvents)
      .leftJoin(users, eq(users.id, leadEvents.userId))
      .where(eq(leadEvents.leadId, row.id))
      .orderBy(desc(leadEvents.createdAt))

    res.json({ data: row, timeline: timeline.map((t) => ({ ...t.event, userName: t.userName })) })
  }),
)

leadRouter.patch(
  '/:id',
  requirePermission('leads:update'),
  validate(updateLeadSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('zod').infer<typeof updateLeadSchema>

    const [existing] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, param(req, 'id')), isNull(leads.deletedAt), branchScope(req.auth!)))
      .limit(1)
    if (!existing) throw notFound('Data calon nasabah tidak ditemukan.')

    if (body.assignedToId !== undefined && !req.auth!.permissions.includes('leads:assign')) {
      throw forbidden('Anda tidak punya hak menugaskan petugas.')
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (body.status) patch.status = body.status
    if (body.assignedToId !== undefined) patch.assignedToId = body.assignedToId
    if (body.branchId !== undefined) patch.branchId = body.branchId
    if (body.status && body.status !== 'baru' && !existing.contactedAt) patch.contactedAt = new Date()

    const [updated] = await db.update(leads).set(patch).where(eq(leads.id, existing.id)).returning()

    const events: (typeof leadEvents.$inferInsert)[] = []
    if (body.status && body.status !== existing.status) {
      events.push({ leadId: existing.id, type: 'status_change', fromValue: existing.status, toValue: body.status, userId: req.auth!.sub })
    }
    if (body.assignedToId !== undefined && body.assignedToId !== existing.assignedToId) {
      events.push({ leadId: existing.id, type: 'assign', fromValue: existing.assignedToId, toValue: body.assignedToId, userId: req.auth!.sub })
    }
    if (body.note) events.push({ leadId: existing.id, type: 'note', note: body.note, userId: req.auth!.sub })
    if (events.length) await db.insert(leadEvents).values(events)

    await audit(req, { action: 'update', entity: 'lead', entityId: existing.id, summary: `Status → ${body.status ?? existing.status}` })
    res.json({ data: updated })
  }),
)

leadRouter.get(
  '/export/csv',
  requirePermission('leads:export'),
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({ lead: leads, productName: products.name, branchName: branches.name })
      .from(leads)
      .leftJoin(products, eq(products.id, leads.productId))
      .leftJoin(branches, eq(branches.id, leads.branchId))
      .where(and(isNull(leads.deletedAt), branchScope(req.auth!)))
      .orderBy(desc(leads.createdAt))
      .limit(10_000)

    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = ['Tanggal', 'Nama', 'WhatsApp', 'Email', 'Minat', 'Produk', 'Cabang', 'Nominal', 'Tenor', 'Estimasi Angsuran', 'Sumber', 'Status', 'Pesan']
    const body = rows.map((r) =>
      [
        new Date(r.lead.createdAt).toLocaleString('id-ID'),
        r.lead.name, r.lead.phone, r.lead.email, r.lead.interest, r.productName, r.branchName,
        r.lead.amount, r.lead.tenorMonths, r.lead.estimatedInstallment, r.lead.source, r.lead.status, r.lead.message,
      ].map(esc).join(','),
    )

    await audit(req, { action: 'export', entity: 'lead', summary: `${rows.length} baris diekspor` })
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`)
    // BOM so Excel opens UTF-8 Indonesian names correctly.
    res.send('﻿' + [header.join(','), ...body].join('\n'))
  }),
)

/* ----------------------------- funnel analytics ---------------------------- */

leadRouter.get(
  '/funnel/overview',
  requirePermission('analytics:read'),
  asyncHandler(async (_req, res) => {
    const [[{ started }], [{ completed }], [{ converted }], [{ contacted }]] = await Promise.all([
      db.select({ started: count() }).from(profilingSessions),
      db.select({ completed: count() }).from(profilingSessions).where(sql`${profilingSessions.completedAt} is not null`),
      db.select({ converted: count() }).from(leads).where(and(isNull(leads.deletedAt), eq(leads.source, 'profiling'))),
      db.select({ contacted: count() }).from(leads).where(and(isNull(leads.deletedAt), sql`${leads.contactedAt} is not null`)),
    ])
    res.json({
      data: {
        profilingStarted: Number(started),
        profilingCompleted: Number(completed),
        leadsFromProfiling: Number(converted),
        leadsContacted: Number(contacted),
      },
    })
  }),
)
