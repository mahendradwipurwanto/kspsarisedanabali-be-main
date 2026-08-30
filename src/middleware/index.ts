import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { z, type ZodTypeAny } from 'zod'
import { and, eq, gt, sql } from 'drizzle-orm'
import { verifyAccessToken, type AccessClaims } from '../lib/auth.js'
import { db, resetPool, loginAttempts, auditLogs } from '../db/index.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessClaims
      clientIp?: string
    }
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message)
  }
}

export const badRequest = (m: string, d?: unknown) => new ApiError(400, m, 'bad_request', d)
export const unauthorized = (m = 'Sesi Anda telah berakhir. Silakan masuk kembali.') => new ApiError(401, m, 'unauthorized')
export const forbidden = (m = 'Anda tidak punya akses ke bagian ini.') => new ApiError(403, m, 'forbidden')
export const notFound = (m = 'Data tidak ditemukan.') => new ApiError(404, m, 'not_found')

/** Wraps an async handler so rejections reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next)
  }

export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string') return fwd.split(',')[0]!.trim()
  return req.socket.remoteAddress ?? 'unknown'
}

export const attachIp: RequestHandler = (req, _res, next) => {
  req.clientIp = clientIp(req)
  next()
}

/**
 * Nothing may hang forever. A connection the SumoPod pooler has already dropped
 * accepts queries that never execute and never time out server-side, so the
 * 15s `statement_timeout` on the session never fires and the request waits
 * until the caller gives up — this stalled the landing page's static build for
 * 60s a route, and on Vercel it would burn the whole function duration.
 *
 * Answering with 503 turns an unbounded hang into a fast, retryable failure.
 * The deadline sits above the statement timeout so a genuinely slow query still
 * reports its real error rather than being masked by this.
 */
export const responseDeadline = (ms = 20_000): RequestHandler => (req, res, next) => {
  const timer = setTimeout(() => {
    if (res.headersSent) return
    console.error('Response deadline exceeded', { path: req.originalUrl, method: req.method, ms })
    // A request only reaches this deadline when its query never came back, which
    // in practice means the connection it holds is dead and will never free its
    // pool slot. Rebuild the pool so the next request gets a live socket.
    resetPool(`response deadline on ${req.method} ${req.originalUrl}`)
    res.status(503).json({
      error: { message: 'Layanan sedang sibuk. Silakan coba beberapa saat lagi.', code: 'upstream_timeout' },
    })
  }, ms)
  timer.unref?.()
  res.on('close', () => clearTimeout(timer))
  next()
}

/* ---------------------------------- auth ----------------------------------- */

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return next(unauthorized())
  const claims = await verifyAccessToken(header.slice(7))
  if (!claims) return next(unauthorized())
  req.auth = claims
  next()
}

/**
 * Permission gate. This is the security boundary — the CMS hiding a button is
 * convenience only. Passing several permissions means "any of these".
 */
export const requirePermission =
  (...permissions: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(unauthorized())
    const granted = req.auth.permissions
    if (permissions.some((p) => granted.includes(p))) return next()
    next(forbidden(`Membutuhkan hak akses: ${permissions.join(' atau ')}`))
  }

/** Optional auth — populates `req.auth` when a valid token is present, never rejects. */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) req.auth = (await verifyAccessToken(header.slice(7))) ?? undefined
  next()
}

/* -------------------------------- validation -------------------------------- */

export const validate =
  <T extends ZodTypeAny>(schema: T, source: 'body' | 'query' | 'params' = 'body'): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source])
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      return next(new ApiError(422, 'Data yang dikirim belum lengkap atau tidak valid.', 'validation_error', details))
    }
    // Express 5 makes req.query a getter; assign onto a scratch property instead.
    if (source === 'query') (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data
    else req[source] = result.data as never
    next()
  }

/**
 * Express 5 types every route param as `string | string[]`. Our routes only ever
 * declare single-value params, so narrow once here instead of casting at each of
 * the ~35 call sites — and keep the compiler working for us rather than silencing it.
 */
export const param = (req: Request, name: string): string => {
  const value = (req.params as Record<string, string | string[] | undefined>)[name]
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

export const validated = <T>(req: Request): T =>
  ((req as Request & { validatedQuery?: unknown }).validatedQuery ?? req.query) as T

/* ------------------------------- rate limiting ------------------------------ */

/**
 * Postgres-backed login throttling. Serverless functions share no memory, so an
 * in-process counter would reset on every cold start.
 *
 * Counted per (email, IP) rather than per email. Keying on email alone lets
 * anyone lock a known administrator out of their own account just by submitting
 * bad passwords for their address — the throttle becomes the attack. A much
 * looser email-wide ceiling still catches guessing spread across many IPs.
 */
export function loginRateLimit(perIp = 8, perEmail = 50, windowMinutes = 15): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const email = String((req.body as { email?: string })?.email ?? '').toLowerCase()
    if (!email) return next()

    const since = new Date(Date.now() - windowMinutes * 60_000)
    const failedSince = and(eq(loginAttempts.email, email), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since))
    const ip = req.clientIp ?? clientIp(req)

    const [[fromThisIp], [forThisEmail]] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(loginAttempts).where(and(failedSince, eq(loginAttempts.ip, ip))),
      db.select({ n: sql<number>`count(*)::int` }).from(loginAttempts).where(failedSince),
    ])

    if ((fromThisIp?.n ?? 0) >= perIp || (forThisEmail?.n ?? 0) >= perEmail) {
      throw new ApiError(429, `Terlalu banyak percobaan masuk. Coba lagi dalam ${windowMinutes} menit.`, 'rate_limited')
    }
    next()
  })
}

/** Generic per-IP limiter for public write endpoints (forms, tracking). */
const buckets = new Map<string, { count: number; resetAt: number }>()
export function ipRateLimit(max: number, windowSeconds: number): RequestHandler {
  return (req, _res, next) => {
    const key = `${req.path}:${req.clientIp ?? clientIp(req)}`
    const now = Date.now()
    const b = buckets.get(key)
    if (!b || b.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
      return next()
    }
    if (++b.count > max) return next(new ApiError(429, 'Terlalu banyak permintaan. Coba lagi sebentar lagi.', 'rate_limited'))
    next()
  }
}

/* --------------------------------- auditing --------------------------------- */

export async function audit(
  req: Request,
  entry: { action: string; entity: string; entityId?: string; summary?: string; meta?: Record<string, unknown> },
) {
  try {
    await db.insert(auditLogs).values({
      userId: req.auth?.sub ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary ?? null,
      meta: entry.meta ?? null,
      ip: req.clientIp ?? null,
    })
  } catch (err) {
    // Auditing must never break the request it is recording.
    console.error('audit write failed', err)
  }
}

/* ------------------------------ error handling ------------------------------ */

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { message: 'Endpoint tidak ditemukan.', code: 'not_found' } })
}

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } })
  }
  if (err instanceof z.ZodError) {
    return res.status(422).json({
      error: { message: 'Data tidak valid.', code: 'validation_error', details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) },
    })
  }
  const e = err as { code?: string; constraint_name?: string; message?: string }
  if (e?.code === '23505') {
    return res.status(409).json({ error: { message: 'Data dengan nilai tersebut sudah ada.', code: 'conflict', details: e.constraint_name } })
  }
  console.error('Unhandled error', { path: req.path, method: req.method, err })
  res.status(500).json({ error: { message: 'Terjadi kesalahan pada server.', code: 'internal_error' } })
}
