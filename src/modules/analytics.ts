import { Router } from 'express'
import { and, desc, eq, gte, sql, count, countDistinct } from 'drizzle-orm'
import { trackEventSchema } from '@mahendradwipurwanto/ksp-contracts'
import { db, pageViews, events, leads, profilingSessions } from '../db/index.js'
import { asyncHandler, validate, requireAuth, requirePermission, ipRateLimit, validated } from '../middleware/index.js'

export const trackRouter: Router = Router()
export const analyticsRouter: Router = Router()

/**
 * First-party beacon. Cookie-free and IP-free — the session id is a random value
 * held in sessionStorage. This exists because GA4 cannot join traffic to leads,
 * and the lead funnel is the number the koperasi actually cares about.
 */
trackRouter.post(
  '/events',
  ipRateLimit(120, 60),
  validate(trackEventSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('zod').infer<typeof trackEventSchema>
    const ua = String(req.headers['user-agent'] ?? '')
    const device = /mobile|android|iphone/i.test(ua) ? 'mobile' : /tablet|ipad/i.test(ua) ? 'tablet' : 'desktop'

    if (body.name === 'page_view') {
      const url = (() => { try { return new URL(body.referrer || '', 'https://x.invalid') } catch { return null } })()
      await db.insert(pageViews).values({
        path: body.path.slice(0, 400),
        sessionId: body.sessionId,
        referrer: body.referrer || null,
        utmSource: (body.meta?.utm_source as string) ?? null,
        utmMedium: (body.meta?.utm_medium as string) ?? null,
        utmCampaign: (body.meta?.utm_campaign as string) ?? null,
        device,
        country: (req.headers['x-vercel-ip-country'] as string) ?? null,
      })
      void url
    } else {
      await db.insert(events).values({
        name: body.name.slice(0, 60),
        path: body.path.slice(0, 400),
        sessionId: body.sessionId,
        meta: body.meta ?? null,
      })
    }

    res.status(204).end()
  }),
)

analyticsRouter.use(requireAuth)

analyticsRouter.get(
  '/overview',
  requirePermission('analytics:read'),
  asyncHandler(async (req, res) => {
    const q = validated<Record<string, string>>(req)
    const days = Math.min(Number(q.days ?? 30), 365)
    const since = new Date(Date.now() - days * 86_400_000)
    const prevSince = new Date(Date.now() - days * 2 * 86_400_000)

    const [[curr], [prev], [leadCount], [prevLeadCount], funnelRows] = await Promise.all([
      db.select({ views: count(), visitors: countDistinct(pageViews.sessionId) }).from(pageViews).where(gte(pageViews.createdAt, since)),
      db
        .select({ views: count(), visitors: countDistinct(pageViews.sessionId) })
        .from(pageViews)
        .where(and(gte(pageViews.createdAt, prevSince), sql`${pageViews.createdAt} < ${since}`)),
      db.select({ n: count() }).from(leads).where(gte(leads.createdAt, since)),
      db.select({ n: count() }).from(leads).where(and(gte(leads.createdAt, prevSince), sql`${leads.createdAt} < ${since}`)),
      db
        .select({ name: events.name, n: count() })
        .from(events)
        .where(gte(events.createdAt, since))
        .groupBy(events.name),
    ])

    const pct = (a: number, b: number) => (b === 0 ? (a > 0 ? 100 : 0) : Math.round(((a - b) / b) * 100))
    const evt = Object.fromEntries(funnelRows.map((r) => [r.name, Number(r.n)]))

    res.json({
      data: {
        rangeDays: days,
        views: { value: Number(curr!.views), changePct: pct(Number(curr!.views), Number(prev!.views)) },
        visitors: { value: Number(curr!.visitors), changePct: pct(Number(curr!.visitors), Number(prev!.visitors)) },
        leads: { value: Number(leadCount!.n), changePct: pct(Number(leadCount!.n), Number(prevLeadCount!.n)) },
        events: evt,
      },
    })
  }),
)

analyticsRouter.get(
  '/funnel',
  requirePermission('analytics:read'),
  asyncHandler(async (req, res) => {
    const days = Math.min(Number(validated<Record<string, string>>(req).days ?? 30), 365)
    const since = new Date(Date.now() - days * 86_400_000)

    const [[views], [started], [completed], [leadsIn], [contacted]] = await Promise.all([
      db.select({ n: countDistinct(pageViews.sessionId) }).from(pageViews).where(gte(pageViews.createdAt, since)),
      db.select({ n: count() }).from(profilingSessions).where(gte(profilingSessions.createdAt, since)),
      db.select({ n: count() }).from(profilingSessions).where(and(gte(profilingSessions.createdAt, since), sql`${profilingSessions.completedAt} is not null`)),
      db.select({ n: count() }).from(leads).where(gte(leads.createdAt, since)),
      db.select({ n: count() }).from(leads).where(and(gte(leads.createdAt, since), sql`${leads.contactedAt} is not null`)),
    ])

    // Presented as a funnel with drop-off percentages so it reads without training.
    const steps = [
      { key: 'visitors', label: 'Pengunjung', value: Number(views!.n) },
      { key: 'profiling_started', label: 'Mulai profiling', value: Number(started!.n) },
      { key: 'profiling_completed', label: 'Selesai profiling', value: Number(completed!.n) },
      { key: 'leads', label: 'Calon nasabah masuk', value: Number(leadsIn!.n) },
      { key: 'contacted', label: 'Sudah dihubungi', value: Number(contacted!.n) },
    ].map((s, i, arr) => ({
      ...s,
      conversionPct: i === 0 || arr[i - 1]!.value === 0 ? 100 : Math.round((s.value / arr[i - 1]!.value) * 100),
    }))

    res.json({ data: { steps, rangeDays: days } })
  }),
)

analyticsRouter.get(
  '/pages',
  requirePermission('analytics:read'),
  asyncHandler(async (req, res) => {
    const days = Math.min(Number(validated<Record<string, string>>(req).days ?? 30), 365)
    const since = new Date(Date.now() - days * 86_400_000)
    const rows = await db
      .select({ path: pageViews.path, views: count(), visitors: countDistinct(pageViews.sessionId) })
      .from(pageViews)
      .where(gte(pageViews.createdAt, since))
      .groupBy(pageViews.path)
      .orderBy(desc(count()))
      .limit(20)
    res.json({ data: rows.map((r) => ({ ...r, views: Number(r.views), visitors: Number(r.visitors) })) })
  }),
)

analyticsRouter.get(
  '/sources',
  requirePermission('analytics:read'),
  asyncHandler(async (req, res) => {
    const days = Math.min(Number(validated<Record<string, string>>(req).days ?? 30), 365)
    const since = new Date(Date.now() - days * 86_400_000)
    const rows = await db
      .select({
        source: sql<string>`coalesce(nullif(${pageViews.utmSource}, ''), case when ${pageViews.referrer} is null or ${pageViews.referrer} = '' then 'Langsung' else split_part(replace(replace(${pageViews.referrer}, 'https://', ''), 'http://', ''), '/', 1) end)`,
        views: count(),
      })
      .from(pageViews)
      .where(gte(pageViews.createdAt, since))
      .groupBy(sql`1`)
      .orderBy(desc(count()))
      .limit(12)
    res.json({ data: rows.map((r) => ({ source: r.source, views: Number(r.views) })) })
  }),
)

analyticsRouter.get(
  '/timeseries',
  requirePermission('analytics:read'),
  asyncHandler(async (req, res) => {
    const days = Math.min(Number(validated<Record<string, string>>(req).days ?? 30), 365)
    const since = new Date(Date.now() - days * 86_400_000)
    const rows = await db
      .select({
        date: sql<string>`to_char(${pageViews.createdAt} at time zone 'Asia/Makassar', 'YYYY-MM-DD')`,
        views: count(),
        visitors: countDistinct(pageViews.sessionId),
      })
      .from(pageViews)
      .where(gte(pageViews.createdAt, since))
      .groupBy(sql`1`)
      .orderBy(sql`1`)
    res.json({ data: rows.map((r) => ({ date: r.date, views: Number(r.views), visitors: Number(r.visitors) })) })
  }),
)
