import { Router } from 'express'
import { and, asc, desc, eq, gte, inArray, isNull, sql, count, countDistinct } from 'drizzle-orm'
import { trackEventSchema } from '../contracts/index.js'
import {
  db, sqlClient, pageViews, events, leads, profilingSessions,
  pages, pageBlocks, branches, products, users,
} from '../db/index.js'
import { asyncHandler, validate, requireAuth, requirePermission, forbidden, ipRateLimit, validated } from '../middleware/index.js'
import { analysePage, type BlockInput } from './pages.js'

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

/* ─────────────────────────────────────────────────────────────────────────
   Each `computeX` does one thing: run its queries and return plain data. The
   route handlers below are thin wrappers around them, and `/dashboard`
   further down calls all of them for one combined response.

   That combination is not a convenience — it is why /dashboard exists at
   all. Firing computeOverview/computeFunnel/computeDevices/... as eight
   separate HTTP requests (which is what the CMS dashboard used to do) meant
   eight independent 20s response-deadline clocks, sharing a connection pool
   that is `max: 1` in production. When any one of those eight requests hit
   its deadline, `resetPool()` tore down the shared connection out from under
   every other request's still-running query — observed directly in testing:
   killing `/content`'s connection surfaced as a CONNECTION_DESTROYED error on
   an unrelated in-flight `testimonials` query from a different request, and a
   plain `leads/summary` call that normally answers in under 200ms timed out
   at exactly the 20s deadline once nine sibling requests were competing with
   it. One request with one deadline cannot cascade-fail this way.
   ───────────────────────────────────────────────────────────────────────── */

async function computeOverview(days: number) {
  const since = new Date(Date.now() - days * 86_400_000)
  const prevSince = new Date(Date.now() - days * 2 * 86_400_000)
  // postgres.js serializes a plain string but not a bare Date object inside a
  // raw `sql` template — drizzle's typed comparators (gte/lt) handle that
  // conversion themselves, but a FILTER clause needs the bound written by
  // hand, so the ISO string is what has to go in, not the Date.
  const sinceIso = since.toISOString()
  const prevSinceIso = prevSince.toISOString()

  // Current and previous period as one conditional-aggregation query each,
  // rather than two — every query here is one more round trip a concurrent
  // dashboard load has to queue behind on a `max: 1` production connection.
  const [[views], [leadCounts], funnelRows] = await Promise.all([
    db
      .select({
        currViews: sql<number>`count(*) filter (where ${pageViews.createdAt} >= ${sinceIso})`,
        currVisitors: sql<number>`count(distinct ${pageViews.sessionId}) filter (where ${pageViews.createdAt} >= ${sinceIso})`,
        prevViews: sql<number>`count(*) filter (where ${pageViews.createdAt} >= ${prevSinceIso} and ${pageViews.createdAt} < ${sinceIso})`,
        prevVisitors: sql<number>`count(distinct ${pageViews.sessionId}) filter (where ${pageViews.createdAt} >= ${prevSinceIso} and ${pageViews.createdAt} < ${sinceIso})`,
      })
      .from(pageViews)
      .where(gte(pageViews.createdAt, prevSince)),

    db
      .select({
        curr: sql<number>`count(*) filter (where ${leads.createdAt} >= ${sinceIso})`,
        prev: sql<number>`count(*) filter (where ${leads.createdAt} >= ${prevSinceIso} and ${leads.createdAt} < ${sinceIso})`,
      })
      .from(leads)
      .where(gte(leads.createdAt, prevSince)),

    db
      .select({ name: events.name, n: count() })
      .from(events)
      .where(gte(events.createdAt, since))
      .groupBy(events.name),
  ])

  const pct = (a: number, b: number) => (b === 0 ? (a > 0 ? 100 : 0) : Math.round(((a - b) / b) * 100))
  const evt = Object.fromEntries(funnelRows.map((r) => [r.name, Number(r.n)]))

  return {
    rangeDays: days,
    views: { value: Number(views!.currViews), changePct: pct(Number(views!.currViews), Number(views!.prevViews)) },
    visitors: { value: Number(views!.currVisitors), changePct: pct(Number(views!.currVisitors), Number(views!.prevVisitors)) },
    leads: { value: Number(leadCounts!.curr), changePct: pct(Number(leadCounts!.curr), Number(leadCounts!.prev)) },
    events: evt,
  }
}

async function computeFunnel(days: number) {
  const since = new Date(Date.now() - days * 86_400_000)

  // Three round trips, not five: profiling's started/completed and leads'
  // in/contacted are each one query with two FILTER clauses instead of two
  // queries against the same table and window.
  const [[views], [profiling], [leadStats]] = await Promise.all([
    db.select({ n: countDistinct(pageViews.sessionId) }).from(pageViews).where(gte(pageViews.createdAt, since)),

    db
      .select({
        started: count(),
        completed: sql<number>`count(*) filter (where ${profilingSessions.completedAt} is not null)`,
      })
      .from(profilingSessions)
      .where(gte(profilingSessions.createdAt, since)),

    db
      .select({
        leadsIn: count(),
        contacted: sql<number>`count(*) filter (where ${leads.contactedAt} is not null)`,
      })
      .from(leads)
      .where(gte(leads.createdAt, since)),
  ])

  // Presented as a funnel with drop-off percentages so it reads without training.
  const steps = [
    { key: 'visitors', label: 'Pengunjung', value: Number(views!.n) },
    { key: 'profiling_started', label: 'Mulai profiling', value: Number(profiling!.started) },
    { key: 'profiling_completed', label: 'Selesai profiling', value: Number(profiling!.completed) },
    { key: 'leads', label: 'Calon nasabah masuk', value: Number(leadStats!.leadsIn) },
    { key: 'contacted', label: 'Sudah dihubungi', value: Number(leadStats!.contacted) },
  ].map((s, i, arr) => ({
    ...s,
    conversionPct: i === 0 || arr[i - 1]!.value === 0 ? 100 : Math.round((s.value / arr[i - 1]!.value) * 100),
  }))

  return { steps, rangeDays: days }
}

async function computeTopPages(days: number) {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await db
    .select({ path: pageViews.path, views: count(), visitors: countDistinct(pageViews.sessionId) })
    .from(pageViews)
    .where(gte(pageViews.createdAt, since))
    .groupBy(pageViews.path)
    .orderBy(desc(count()))
    .limit(20)
  return rows.map((r) => ({ ...r, views: Number(r.views), visitors: Number(r.visitors) }))
}

async function computeSources(days: number) {
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
  return rows.map((r) => ({ source: r.source, views: Number(r.views) }))
}

async function computeTimeseries(days: number) {
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
  return rows.map((r) => ({ date: r.date, views: Number(r.views), visitors: Number(r.visitors) }))
}

/**
 * Traffic by device class. Nothing more granular than the three buckets
 * `trackRouter` already writes at ingest — no user-agent parsing here, so this
 * can never drift from what `/events` actually recorded.
 */
async function computeDevices(days: number) {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await db
    .select({ device: sql<string>`coalesce(${pageViews.device}, 'unknown')`, views: count() })
    .from(pageViews)
    .where(gte(pageViews.createdAt, since))
    .groupBy(sql`1`)
    .orderBy(desc(count()))

  const total = rows.reduce((sum, r) => sum + Number(r.views), 0)
  return rows.map((r) => ({
    device: r.device,
    views: Number(r.views),
    pct: total === 0 ? 0 : Math.round((Number(r.views) / total) * 1000) / 10,
  }))
}

/**
 * A site-wide inventory. Every number here is something a manager would
 * otherwise have to open six different list pages and count by hand.
 *
 * One round trip for every count on the page, instead of ten: in production
 * the connection pool is `max: 1` (see db/index.ts), so parallel queries do
 * not actually run concurrently — postgres.js queues them onto that single
 * connection, and ten-plus sequential round trips to a cluster that is not
 * always fast (PROJECT-PLAN.md §15.1) is exactly the shape of request that
 * clears a 20s deadline. Scalar subqueries collapse it to one statement.
 */
async function computeContent() {
  /**
   * `.simple()` — this query takes no parameters, so there is nothing for the
   * prepared-statement machinery to buy it, and under two concurrent
   * `/dashboard` requests it produced `prepared statement "..." does not
   * exist` (PostgresError 26000): the shared pool's session affinity is not
   * airtight enough to guarantee the connection that PREPAREd the statement is
   * the one that later EXECUTEs it. Simple query protocol sends the statement
   * and runs it in one round trip with no PREPARE/EXECUTE split, so there is
   * no statement identity for pool churn to invalidate.
   */
  const [totals] = await sqlClient<{
    posts_total: number; posts_published: number; posts_draft: number
    products_total: number; products_verified: number; products_active: number
    branches_total: number; branches_active: number
    jobs_total: number; jobs_open: number
    applications_total: number; applications_pending: number
    media_total: number; media_missing_alt: number; media_bytes: number
    testimonials_total: number; testimonials_active: number
    faqs_total: number; faqs_active: number
    documents_total: number
    users_total: number; users_active: number
  }[]>`
    select
      (select count(*)::int from posts where deleted_at is null) as posts_total,
      (select count(*)::int from posts where deleted_at is null and status = 'published') as posts_published,
      (select count(*)::int from posts where deleted_at is null and status = 'draft') as posts_draft,
      (select count(*)::int from products where deleted_at is null) as products_total,
      (select count(*)::int from products where deleted_at is null and is_verified) as products_verified,
      (select count(*)::int from products where deleted_at is null and is_active) as products_active,
      (select count(*)::int from branches) as branches_total,
      (select count(*)::int from branches where is_active) as branches_active,
      (select count(*)::int from jobs) as jobs_total,
      (select count(*)::int from jobs where is_active and (closes_at is null or closes_at > now())) as jobs_open,
      (select count(*)::int from job_applications) as applications_total,
      (select count(*)::int from job_applications where status = 'baru') as applications_pending,
      (select count(*)::int from media) as media_total,
      (select count(*)::int from media where alt is null or alt = '') as media_missing_alt,
      (select coalesce(sum(size), 0)::bigint from media) as media_bytes,
      (select count(*)::int from testimonials) as testimonials_total,
      (select count(*)::int from testimonials where is_active) as testimonials_active,
      (select count(*)::int from faqs) as faqs_total,
      (select count(*)::int from faqs where is_active) as faqs_active,
      (select count(*)::int from documents) as documents_total,
      (select count(*)::int from users where deleted_at is null) as users_total,
      (select count(*)::int from users where deleted_at is null and is_active) as users_active
  `.simple()
  const t = totals!

  // Small table — every non-deleted page, scored the same way the editor
  // scores one page, so the dashboard number and the editor's badge never
  // disagree about what counts as "needs attention".
  const pageRows = await db
    .select({ id: pages.id, title: pages.title, slug: pages.slug, status: pages.status, seo: pages.seo })
    .from(pages)
    .where(isNull(pages.deletedAt))

  const allBlocks = pageRows.length
    ? await db.select().from(pageBlocks).where(inArray(pageBlocks.pageId, pageRows.map((p) => p.id))).orderBy(asc(pageBlocks.position))
    : []
  const blocksByPage = new Map<string, BlockInput[]>()
  for (const b of allBlocks) {
    const list = blocksByPage.get(b.pageId) ?? []
    list.push(b as BlockInput)
    blocksByPage.set(b.pageId, list)
  }

  let scoreSum = 0
  let good = 0, warn = 0, bad = 0
  const needsAttention: { id: string; title: string; slug: string; status: string; score: number }[] = []
  for (const p of pageRows) {
    const { score } = analysePage({ title: p.title, slug: p.slug, seo: p.seo, blocks: blocksByPage.get(p.id) ?? [] })
    scoreSum += score
    if (score >= 85) good++
    else if (score >= 60) { warn++; needsAttention.push({ id: p.id, title: p.title, slug: p.slug, status: p.status, score }) }
    else { bad++; needsAttention.push({ id: p.id, title: p.title, slug: p.slug, status: p.status, score }) }
  }
  needsAttention.sort((a, b) => a.score - b.score)

  return {
    pages: {
      total: pageRows.length,
      published: pageRows.filter((p) => p.status === 'published').length,
      draft: pageRows.filter((p) => p.status === 'draft').length,
      avgSeoScore: pageRows.length ? Math.round(scoreSum / pageRows.length) : 0,
      distribution: { good, warn, bad },
      needsAttention: needsAttention.slice(0, 8),
    },
    posts: { total: t.posts_total, published: t.posts_published, draft: t.posts_draft },
    products: { total: t.products_total, verified: t.products_verified, active: t.products_active },
    branches: { total: t.branches_total, active: t.branches_active },
    jobs: { total: t.jobs_total, open: t.jobs_open, applications: t.applications_total, pendingApplications: t.applications_pending },
    media: {
      total: t.media_total,
      missingAlt: t.media_missing_alt,
      totalSizeMb: Math.round((Number(t.media_bytes) / 1_048_576) * 10) / 10,
    },
    testimonials: { total: t.testimonials_total, active: t.testimonials_active },
    faqs: { total: t.faqs_total, active: t.faqs_active },
    documents: { total: t.documents_total },
    users: { total: t.users_total, active: t.users_active },
  }
}

/**
 * Lead insights beyond the status tally `leads/summary` already gives:
 * where they come from, which branch and product they land on, and how long
 * they wait for a first response.
 *
 * Scoped the same way the leads list is — a branch-only user must not learn
 * volume for a branch they cannot open, so the query filters rather than
 * trusting the client to only ask for its own branch.
 */
async function computeLeadsInsights(days: number, auth: { permissions: string[]; branchIds: string[] }) {
  const since = new Date(Date.now() - days * 86_400_000)

  const scope = auth.permissions.includes('leads:read:all')
    ? undefined
    : auth.branchIds.length
      ? inArray(leads.branchId, auth.branchIds)
      : sql`false`
  if (!auth.permissions.includes('leads:read:all') && !auth.permissions.includes('leads:read:branch')) throw forbidden()

  const where = and(isNull(leads.deletedAt), gte(leads.createdAt, since), scope)

  const [bySource, byBranch, byProduct, [totals], [responseTime]] = await Promise.all([
    db.select({ source: leads.source, n: count() }).from(leads).where(where).groupBy(leads.source).orderBy(desc(count())),

    db
      .select({ branchId: leads.branchId, branchName: branches.name, n: count() })
      .from(leads)
      .leftJoin(branches, eq(branches.id, leads.branchId))
      .where(where)
      .groupBy(leads.branchId, branches.name)
      .orderBy(desc(count()))
      .limit(10),

    db
      .select({ productId: leads.productId, productName: products.name, category: products.category, n: count() })
      .from(leads)
      .leftJoin(products, eq(products.id, leads.productId))
      .where(where)
      .groupBy(leads.productId, products.name, products.category)
      .orderBy(desc(count()))
      .limit(10),

    db
      .select({ total: count(), converted: sql<number>`count(*) filter (where status = 'selesai')` })
      .from(leads)
      .where(where),

    // Average hours from a lead landing to someone marking it contacted —
    // the number that actually predicts whether a member picks up the phone.
    db
      .select({ avgHours: sql<number | null>`avg(extract(epoch from (contacted_at - created_at)) / 3600) filter (where contacted_at is not null)` })
      .from(leads)
      .where(where),
  ])

  return {
    rangeDays: days,
    bySource: bySource.map((r) => ({ source: r.source, count: Number(r.n) })),
    byBranch: byBranch.map((r) => ({ branchId: r.branchId, branchName: r.branchName ?? 'Belum ditentukan', count: Number(r.n) })),
    byProduct: byProduct
      .filter((r) => r.productId)
      .map((r) => ({ productId: r.productId, productName: r.productName ?? '—', category: r.category, count: Number(r.n) })),
    conversionPct: Number(totals!.total) === 0 ? 0 : Math.round((Number(totals!.converted) / Number(totals!.total)) * 100),
    avgResponseHours: responseTime!.avgHours === null ? null : Math.round(Number(responseTime!.avgHours) * 10) / 10,
  }
}

/* ─────────────────────────────────────────────────────────────────── routes ── */

analyticsRouter.get('/overview', requirePermission('analytics:read'), asyncHandler(async (req, res) => {
  const days = Math.min(Number(validated<Record<string, string>>(req).days ?? 30), 365)
  res.json({ data: await computeOverview(days) })
}))

analyticsRouter.get('/funnel', requirePermission('analytics:read'), asyncHandler(async (req, res) => {
  const days = Math.min(Number(validated<Record<string, string>>(req).days ?? 30), 365)
  res.json({ data: await computeFunnel(days) })
}))

analyticsRouter.get('/pages', requirePermission('analytics:read'), asyncHandler(async (req, res) => {
  const days = Math.min(Number(validated<Record<string, string>>(req).days ?? 30), 365)
  res.json({ data: await computeTopPages(days) })
}))

analyticsRouter.get('/sources', requirePermission('analytics:read'), asyncHandler(async (req, res) => {
  const days = Math.min(Number(validated<Record<string, string>>(req).days ?? 30), 365)
  res.json({ data: await computeSources(days) })
}))

analyticsRouter.get('/timeseries', requirePermission('analytics:read'), asyncHandler(async (req, res) => {
  const days = Math.min(Number(validated<Record<string, string>>(req).days ?? 30), 365)
  res.json({ data: await computeTimeseries(days) })
}))

analyticsRouter.get('/devices', requirePermission('analytics:read'), asyncHandler(async (req, res) => {
  const days = Math.min(Number(validated<Record<string, string>>(req).days ?? 30), 365)
  res.json({ data: await computeDevices(days) })
}))

analyticsRouter.get('/content', requirePermission('analytics:read'), asyncHandler(async (_req, res) => {
  res.json({ data: await computeContent() })
}))

analyticsRouter.get('/leads', requirePermission('leads:read:all', 'leads:read:branch'), asyncHandler(async (req, res) => {
  const days = Math.min(Number(validated<Record<string, string>>(req).days ?? 30), 365)
  res.json({ data: await computeLeadsInsights(days, req.auth!) })
}))

/**
 * Everything the CMS dashboard's landing page needs that sits behind
 * `analytics:read`, in one request.
 *
 * The lead breakdown is deliberately NOT included here even though
 * `computeLeadsInsights` exists — it stays its own request via `/leads`
 * below, gated on `leads:read:all`/`leads:read:branch` rather than
 * `analytics:read`. Branch staff hold the former but not the latter (see
 * SYSTEM_ROLES.branch_staff in permissions.ts); folding it in here would have
 * silently dropped their leads panel.
 *
 * The rest is combined because it used to be seven separate HTTP requests
 * fired in parallel, each racing the same `max: 1` production connection
 * under its own 20s deadline. One request's deadline firing rebuilds the
 * pool, which destroys every *other* request's in-flight connection too — a
 * single slow neighbour could take the whole dashboard down. One request
 * means one deadline for the whole batch instead of seven chances to trip it.
 *
 * `allSettled` rather than `all`: a genuine failure in one section should not
 * blank the traffic chart next to it. Each section fails independently and is
 * logged, never silently swallowed.
 */
analyticsRouter.get('/dashboard', requirePermission('analytics:read'), asyncHandler(async (req, res) => {
  const days = Math.min(Number(validated<Record<string, string>>(req).days ?? 30), 365)

  const [overview, funnel, topPages, sources, timeseries, devices, content] = await Promise.allSettled([
    computeOverview(days),
    computeFunnel(days),
    computeTopPages(days),
    computeSources(days),
    computeTimeseries(days),
    computeDevices(days),
    computeContent(),
  ])

  const settle = <T>(label: string, r: PromiseSettledResult<T>, fallback: T): T => {
    if (r.status === 'fulfilled') return r.value
    console.error(`analytics/dashboard: ${label} failed`, r.reason)
    return fallback
  }

  /**
   * `Promise.allSettled` above can still be running past the 20s deadline —
   * settling does not mean settling *quickly*. If the deadline middleware has
   * already answered this request with its own 503, sending a second response
   * here throws ERR_HTTP_HEADERS_SENT. The client already has its answer;
   * this response has nowhere to go.
   */
  if (res.headersSent) return

  res.json({
    data: {
      rangeDays: days,
      overview: settle('overview', overview, null),
      funnel: settle('funnel', funnel, { steps: [], rangeDays: days }),
      topPages: settle('topPages', topPages, []),
      sources: settle('sources', sources, []),
      timeseries: settle('timeseries', timeseries, []),
      devices: settle('devices', devices, []),
      content: settle('content', content, null),
    },
  })
}))
