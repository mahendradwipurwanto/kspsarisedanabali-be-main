import { Router } from 'express'
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import { loginSchema } from '../contracts/index.js'
import { db, users, roles, userRoles, userBranches, refreshTokens, loginAttempts } from '../db/index.js'
import {
  hashPassword, verifyPassword, signAccessToken, generateRefreshToken, sealRefreshCookie, openRefreshCookie,
  hashToken, signMfaChallenge, verifyMfaChallenge, REFRESH_COOKIE, refreshCookieOptions, type AccessClaims,
} from '../lib/auth.js'
import {
  seal, open, generateTotpSecret, totpUri, verifyTotp, generateRecoveryCodes, hashRecoveryCode, randomToken, deviceLabel, consumeChallenge } from '../lib/crypto.js'
import { env, mfaRequiredRoles } from '../lib/env.js'
import { asyncHandler, validate, requireAuth, unauthorized, forbidden, ApiError, loginRateLimit, audit, endSessions, forgetSession } from '../middleware/index.js'

export const authRouter: Router = Router()

const ISSUER = 'KSP Sari Sedana Bali'

/** Assemble the caller's effective permissions — the union across all their roles. */
export async function buildClaims(userId: string, session?: { id: string; mfa: boolean }): Promise<AccessClaims | null> {
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1)
  if (!user || !user.isActive) return null

  const roleRows = await db
    .select({ key: roles.key, name: roles.name, permissions: roles.permissions })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))

  const branchRows = await db.select({ branchId: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, userId))

  return {
    sub: user.id,
    name: user.name,
    email: user.email,
    permissions: [...new Set(roleRows.flatMap((r) => r.permissions ?? []))],
    roles: roleRows.map((r) => r.key),
    branchIds: branchRows.map((b) => b.branchId),
    ...(session ? { sid: session.id, mfa: session.mfa } : {}),
  }
}

const mustHaveMfa = (roleKeys: string[]) => roleKeys.some((r) => mfaRequiredRoles.includes(r))

/**
 * Open a session: a refresh row, a per-session signing key, and a cookie that
 * carries nothing readable. Signing in beyond the per-user limit ends the
 * session that has been quiet the longest.
 */
async function issueSession(userId: string, req: { headers: Record<string, unknown>; clientIp?: string }, mfaAt: Date | null) {
  const now = new Date()
  const active = await db
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, now)))
    .orderBy(desc(sql`coalesce(${refreshTokens.lastSeenAt}, ${refreshTokens.createdAt})`))
  for (const old of active.slice(Math.max(0, env.SESSION_MAX_PER_USER - 1))) {
    await db.update(refreshTokens).set({ revokedAt: now, revokedReason: 'limit' }).where(eq(refreshTokens.id, old.id))
    forgetSession(old.id)
  }

  const { raw, hash } = generateRefreshToken()
  const signingKey = randomToken(32)
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300)
  const [row] = await db
    .insert(refreshTokens)
    .values({
      userId,
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + env.REFRESH_TTL_DAYS * 86_400_000),
      userAgent,
      label: deviceLabel(userAgent),
      ip: req.clientIp ?? null,
      signingKey: seal(signingKey),
      lastSeenAt: now,
      mfaAt,
    })
    .returning({ id: refreshTokens.id })
  return { cookie: await sealRefreshCookie(userId, row!.id, raw), sessionId: row!.id, signingKey }
}

/** What every successful sign-in and refresh answers with. */
async function sessionResponse(userId: string, session: { sessionId: string; signingKey: string; mfa: boolean }) {
  const claims = await buildClaims(userId, { id: session.sessionId, mfa: session.mfa })
  if (!claims) throw unauthorized()
  const [user] = await db.select({ totpEnabled: users.totpEnabled }).from(users).where(eq(users.id, userId)).limit(1)
  return {
    accessToken: await signAccessToken(claims),
    user: claims,
    expiresIn: env.ACCESS_TTL_MIN * 60,
    session: {
      id: session.sessionId,
      signingKey: session.signingKey,
      signing: env.REQUEST_SIGNING,
      idleMinutes: env.SESSION_IDLE_MIN,
      mfa: session.mfa,
    },
    mfaEnabled: Boolean(user?.totpEnabled),
    mfaSetupRequired: !user?.totpEnabled && mustHaveMfa(claims.roles),
  }
}

authRouter.post(
  '/login',
  validate(loginSchema),
  loginRateLimit(),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string }
    const lower = email.toLowerCase()

    const [user] = await db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = ${lower}`, isNull(users.deletedAt)))
      .limit(1)

    const okPassword = user ? await verifyPassword(password, user.passwordHash) : false
    await db.insert(loginAttempts).values({ email: lower, ip: req.clientIp ?? null, success: okPassword })

    // Same message either way — never reveal whether the address exists.
    if (!user || !okPassword) throw new ApiError(401, 'Email atau kata sandi salah.', 'invalid_credentials')
    if (!user.isActive) throw new ApiError(403, 'Akun Anda dinonaktifkan. Hubungi administrator.', 'account_disabled')

    // A second factor, when set up, is asked for before any session exists.
    if (user.totpEnabled) {
      await audit(req, { action: 'login_mfa_challenge', entity: 'user', entityId: user.id, summary: `${user.name} lolos kata sandi, menunggu kode` })
      res.json({ mfaRequired: true, challenge: await signMfaChallenge(user.id) })
      return
    }

    const session = await issueSession(user.id, req, null)
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))
    await audit(req, { action: 'login', entity: 'user', entityId: user.id, summary: `${user.name} masuk` })

    res.cookie(REFRESH_COOKIE, session.cookie, refreshCookieOptions())
    res.json(await sessionResponse(user.id, { ...session, mfa: false }))
  }),
)

/** Second step: the authenticator code, or one of the recovery codes. */
authRouter.post(
  '/login/mfa',
  loginRateLimit(),
  asyncHandler(async (req, res) => {
    const { challenge, code } = req.body as { challenge?: string; code?: string }
    if (!challenge || !code) throw new ApiError(422, 'Kode wajib diisi.', 'validation_error')
    const chal = await verifyMfaChallenge(challenge)
    if (!chal) throw new ApiError(401, 'Sesi verifikasi sudah kedaluwarsa. Masuk lagi dari awal.', 'challenge_expired')
    const userId = chal.userId

    const [user] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1)
    if (!user || !user.isActive || !user.totpEnabled) throw unauthorized()

    const secret = open(user.totpSecret)
    // The accepted step is remembered so the same code cannot be replayed
    // inside its 30-second window.
    const step = secret ? verifyTotp(secret, code, user.totpLastStep ?? -1) : null
    let passed = step !== null
    let usedRecovery = false
    if (!passed) {
      const h = hashRecoveryCode(code)
      if (user.recoveryCodes.includes(h)) {
        passed = true
        usedRecovery = true
        await db.update(users).set({ recoveryCodes: user.recoveryCodes.filter((x) => x !== h) }).where(eq(users.id, user.id))
      }
    }
    await db.insert(loginAttempts).values({ email: user.email.toLowerCase(), ip: req.clientIp ?? null, success: passed })
    if (!passed) throw new ApiError(401, 'Kode tidak valid. Periksa jam ponsel Anda, lalu coba kode berikutnya.', 'invalid_code')
    if (!consumeChallenge(chal.jti)) throw new ApiError(401, 'Sesi verifikasi sudah dipakai. Masuk lagi dari awal.', 'challenge_used')

    const session = await issueSession(user.id, req, new Date())
    await db.update(users).set({ lastLoginAt: new Date(), ...(step !== null ? { totpLastStep: step } : {}) }).where(eq(users.id, user.id))
    await audit(req, { action: usedRecovery ? 'login_recovery_code' : 'login_mfa', entity: 'user', entityId: user.id, summary: `${user.name} masuk${usedRecovery ? ' dengan kode pemulihan' : ''}` })

    res.cookie(REFRESH_COOKIE, session.cookie, refreshCookieOptions())
    res.json({ ...(await sessionResponse(user.id, { ...session, mfa: true })), recoveryCodesLeft: usedRecovery ? user.recoveryCodes.length - 1 : undefined })
  }),
)

/**
 * Refresh with rotation. The presented cookie must match the row's secret, the
 * row must be live and recently used, and a row that was already rotated being
 * presented again means the cookie was copied — every session of that user ends.
 */
authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]
    if (!cookie) throw unauthorized()
    const decoded = await openRefreshCookie(cookie)
    if (!decoded) throw unauthorized()

    const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.id, decoded.tokenId)).limit(1)
    const now = new Date()
    if (!row || row.userId !== decoded.userId || hashToken(decoded.raw) !== row.tokenHash) throw unauthorized()
    if (row.revokedAt) {
      if (row.replacedById) {
        await endSessions(decoded.userId, 'reuse')
        await audit(req, { action: 'session_reuse_detected', entity: 'user', entityId: decoded.userId, summary: 'Cookie sesi lama dipakai lagi; semua sesi diakhiri' })
      }
      throw unauthorized()
    }
    if (row.expiresAt < now) throw unauthorized()
    const idleLimit = new Date(now.getTime() - env.SESSION_IDLE_MIN * 60_000)
    if ((row.lastSeenAt ?? row.createdAt) < idleLimit) {
      await db.update(refreshTokens).set({ revokedAt: now, revokedReason: 'idle' }).where(eq(refreshTokens.id, row.id))
      forgetSession(row.id)
      throw unauthorized('Sesi berakhir karena lama tidak dipakai. Silakan masuk kembali.')
    }

    const session = await issueSession(decoded.userId, req, row.mfaAt)
    await db.update(refreshTokens).set({ revokedAt: now, revokedReason: 'rotated', replacedById: session.sessionId }).where(eq(refreshTokens.id, row.id))
    forgetSession(row.id)

    res.cookie(REFRESH_COOKIE, session.cookie, refreshCookieOptions())
    res.json(await sessionResponse(decoded.userId, { ...session, mfa: Boolean(row.mfaAt) }))
  }),
)

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]
    if (cookie) {
      const decoded = await openRefreshCookie(cookie)
      if (decoded) {
        await db.update(refreshTokens).set({ revokedAt: new Date(), revokedReason: 'logout' }).where(and(eq(refreshTokens.id, decoded.tokenId), isNull(refreshTokens.revokedAt)))
        forgetSession(decoded.tokenId)
      }
    }
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined })
    res.json({ ok: true })
  }),
)

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const claims = await buildClaims(req.auth!.sub, { id: req.session!.id, mfa: Boolean(req.session!.mfaAt) })
    if (!claims) throw unauthorized()
    const [user] = await db.select({ totpEnabled: users.totpEnabled, totpVerifiedAt: users.totpVerifiedAt, recoveryCodes: users.recoveryCodes, passwordChangedAt: users.passwordChangedAt }).from(users).where(eq(users.id, claims.sub)).limit(1)
    res.json({
      user: claims,
      mfaEnabled: Boolean(user?.totpEnabled),
      mfaSetupRequired: !user?.totpEnabled && mustHaveMfa(claims.roles),
      mfaVerifiedAt: user?.totpVerifiedAt ?? null,
      recoveryCodesLeft: user?.recoveryCodes.length ?? 0,
      passwordChangedAt: user?.passwordChangedAt ?? null,
      session: { id: req.session!.id, mfa: Boolean(req.session!.mfaAt), idleMinutes: env.SESSION_IDLE_MIN },
    })
  }),
)

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string }
    if (!currentPassword || !newPassword || newPassword.length < 10) {
      throw new ApiError(422, 'Kata sandi baru minimal 10 karakter.', 'validation_error')
    }
    const [user] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1)
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ApiError(400, 'Kata sandi saat ini salah.', 'invalid_credentials')
    }
    await db.update(users).set({ passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id))
    // Every other device signs in again; this one keeps working.
    await endSessions(user.id, 'password', req.session!.id)
    await audit(req, { action: 'change_password', entity: 'user', entityId: user.id })
    res.json({ ok: true })
  }),
)

/* ---------------------------------- sessions --------------------------------- */

const maskIp = (ip: string | null) => {
  if (!ip) return null
  const v = ip.replace(/^::ffff:/i, '')
  if (v === '::1' || v === '127.0.0.1') return 'perangkat lokal'
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) return v.replace(/\.\d+$/, '.×')
  const groups = v.split(':').filter(Boolean)
  return groups.slice(0, 2).join(':') + ':…'
}

authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({ id: refreshTokens.id, label: refreshTokens.label, userAgent: refreshTokens.userAgent, ip: refreshTokens.ip, createdAt: refreshTokens.createdAt, lastSeenAt: refreshTokens.lastSeenAt, expiresAt: refreshTokens.expiresAt, mfaAt: refreshTokens.mfaAt })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, req.auth!.sub), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
      .orderBy(desc(sql`coalesce(${refreshTokens.lastSeenAt}, ${refreshTokens.createdAt})`))
      .limit(20)
    res.json({
      data: rows.map((r) => ({
        id: r.id, label: r.label ?? deviceLabel(r.userAgent ?? ''), ip: maskIp(r.ip), createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, expiresAt: r.expiresAt,
        mfa: Boolean(r.mfaAt), current: r.id === req.session!.id,
      })),
    })
  }),
)

/** End every session but this one — "keluar dari perangkat lain". */
authRouter.delete(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ended = await endSessions(req.auth!.sub, 'user', req.session!.id)
    await audit(req, { action: 'sessions_ended', entity: 'user', entityId: req.auth!.sub, summary: `${ended} sesi lain diakhiri` })
    res.json({ ok: true, ended })
  }),
)

authRouter.delete(
  '/sessions/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id)
    const [row] = await db.select({ id: refreshTokens.id }).from(refreshTokens).where(and(eq(refreshTokens.id, id), eq(refreshTokens.userId, req.auth!.sub), isNull(refreshTokens.revokedAt))).limit(1)
    if (!row) throw new ApiError(404, 'Sesi tidak ditemukan.', 'not_found')
    await db.update(refreshTokens).set({ revokedAt: new Date(), revokedReason: 'user' }).where(eq(refreshTokens.id, id))
    forgetSession(id)
    await audit(req, { action: 'session_ended', entity: 'user', entityId: req.auth!.sub, summary: id === req.session!.id ? 'Sesi ini diakhiri' : 'Satu sesi lain diakhiri' })
    res.json({ ok: true, current: id === req.session!.id })
  }),
)

/* ------------------------------------ MFA ------------------------------------ */

/** Step one: a secret for the authenticator app. Pending until a code proves it was scanned. */
authRouter.post(
  '/mfa/setup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1)
    if (!user) throw unauthorized()
    if (user.totpEnabled) throw new ApiError(400, 'Verifikasi dua langkah sudah aktif. Nonaktifkan dulu untuk mengganti aplikasi.', 'mfa_already_enabled')
    const secret = generateTotpSecret()
    await db.update(users).set({ totpSecret: seal(secret), totpEnabled: false, updatedAt: new Date() }).where(eq(users.id, user.id))
    res.json({ data: { secret, uri: totpUri(secret, user.email, ISSUER), issuer: ISSUER, account: user.email } })
  }),
)

/** Step two: the first code from the app switches it on and hands out recovery codes, once. */
authRouter.post(
  '/mfa/enable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code } = req.body as { code?: string }
    const [user] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1)
    if (!user) throw unauthorized()
    if (user.totpEnabled) throw new ApiError(400, 'Verifikasi dua langkah sudah aktif.', 'mfa_already_enabled')
    const secret = open(user.totpSecret)
    if (!secret) throw new ApiError(400, 'Mulai dari langkah pemindaian dulu.', 'mfa_not_started')
    const step = code ? verifyTotp(secret, code, user.totpLastStep ?? -1) : null
    if (step === null) throw new ApiError(400, 'Kode tidak cocok. Pastikan jam ponsel akurat, lalu masukkan kode terbaru.', 'invalid_code')

    const now = new Date()
    const recovery = generateRecoveryCodes()
    await db.update(users).set({ totpEnabled: true, totpVerifiedAt: now, recoveryCodes: recovery.hashes, totpLastStep: step, updatedAt: now }).where(eq(users.id, user.id))
    await db.update(refreshTokens).set({ mfaAt: now }).where(eq(refreshTokens.id, req.session!.id))
    forgetSession(req.session!.id)
    // Other devices signed in with a password alone; they sign in again, with the code.
    await endSessions(user.id, 'mfa', req.session!.id)
    await audit(req, { action: 'mfa_enabled', entity: 'user', entityId: user.id, summary: `${user.name} mengaktifkan verifikasi dua langkah` })
    res.json({ ok: true, recoveryCodes: recovery.plain })
  }),
)

authRouter.post(
  '/mfa/disable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { password, code } = req.body as { password?: string; code?: string }
    const [user] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1)
    if (!user) throw unauthorized()
    if (!user.totpEnabled) throw new ApiError(400, 'Verifikasi dua langkah belum aktif.', 'mfa_not_enabled')
    if (mustHaveMfa(req.auth!.roles)) throw forbidden('Peran Anda wajib memakai verifikasi dua langkah; tidak bisa dinonaktifkan.')
    if (!password || !(await verifyPassword(password, user.passwordHash))) throw new ApiError(400, 'Kata sandi salah.', 'invalid_credentials')
    const secret = open(user.totpSecret)
    const okCode = Boolean(code) && ((secret && verifyTotp(secret, code!, user.totpLastStep ?? -1) !== null) || user.recoveryCodes.includes(hashRecoveryCode(code!)))
    if (!okCode) throw new ApiError(400, 'Kode tidak valid.', 'invalid_code')
    await db.update(users).set({ totpSecret: null, totpEnabled: false, totpVerifiedAt: null, recoveryCodes: [], updatedAt: new Date() }).where(eq(users.id, user.id))
    await audit(req, { action: 'mfa_disabled', entity: 'user', entityId: user.id, summary: `${user.name} menonaktifkan verifikasi dua langkah` })
    res.json({ ok: true })
  }),
)

/** New recovery codes; the old set stops working the moment these are issued. */
authRouter.post(
  '/mfa/recovery-codes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code } = req.body as { code?: string }
    const [user] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1)
    if (!user || !user.totpEnabled) throw new ApiError(400, 'Verifikasi dua langkah belum aktif.', 'mfa_not_enabled')
    const secret = open(user.totpSecret)
    const step = code && secret ? verifyTotp(secret, code, user.totpLastStep ?? -1) : null
    if (step === null) throw new ApiError(400, 'Kode tidak valid.', 'invalid_code')
    const recovery = generateRecoveryCodes()
    await db.update(users).set({ recoveryCodes: recovery.hashes, totpLastStep: step, updatedAt: new Date() }).where(eq(users.id, user.id))
    await audit(req, { action: 'mfa_recovery_codes', entity: 'user', entityId: user.id, summary: 'Kode pemulihan dibuat ulang' })
    res.json({ ok: true, recoveryCodes: recovery.plain })
  }),
)

// Referenced for its side effect on the schema type; keeps `ne` in scope for future filters.
void ne
