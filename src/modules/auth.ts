import { Router } from 'express'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { loginSchema } from '@mahendradwipurwanto/ksp-contracts'
import { db, users, roles, userRoles, userBranches, refreshTokens, loginAttempts } from '../db/index.js'
import {
  hashPassword, verifyPassword, signAccessToken, generateRefreshToken, signRefreshJwt,
  verifyRefreshJwt, hashToken, REFRESH_COOKIE, refreshCookieOptions, type AccessClaims,
} from '../lib/auth.js'
import { env } from '../lib/env.js'
import { asyncHandler, validate, requireAuth, unauthorized, ApiError, loginRateLimit, audit } from '../middleware/index.js'

export const authRouter: Router = Router()

/** Assemble the caller's effective permissions — the union across all their roles. */
export async function buildClaims(userId: string): Promise<AccessClaims | null> {
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
  }
}

async function issueSession(userId: string, req: { headers: Record<string, unknown>; clientIp?: string }) {
  const { raw, hash } = generateRefreshToken()
  const expiresAt = new Date(Date.now() + env.REFRESH_TTL_DAYS * 86_400_000)
  const [row] = await db
    .insert(refreshTokens)
    .values({
      userId,
      tokenHash: hash,
      expiresAt,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      ip: req.clientIp ?? null,
    })
    .returning({ id: refreshTokens.id })
  return { refreshJwt: await signRefreshJwt(userId, row!.id), raw, tokenRowId: row!.id }
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

    const claims = await buildClaims(user.id)
    if (!claims) throw unauthorized()

    const { refreshJwt } = await issueSession(user.id, req)
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))
    await audit(req, { action: 'login', entity: 'user', entityId: user.id, summary: `${user.name} masuk` })

    res.cookie(REFRESH_COOKIE, refreshJwt, refreshCookieOptions())
    res.json({ accessToken: await signAccessToken(claims), user: claims, expiresIn: env.ACCESS_TTL_MIN * 60 })
  }),
)

/** Refresh with rotation — the presented token is revoked as the new one is issued. */
authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]
    if (!token) throw unauthorized()

    const decoded = await verifyRefreshJwt(token)
    if (!decoded) throw unauthorized()

    const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.id, decoded.tokenId)).limit(1)
    if (!row || row.revokedAt || row.expiresAt < new Date() || row.userId !== decoded.userId) {
      // A revoked token being replayed suggests theft — drop every session for this user.
      if (row?.revokedAt) {
        await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, decoded.userId))
      }
      throw unauthorized()
    }

    const claims = await buildClaims(decoded.userId)
    if (!claims) throw unauthorized()

    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id))
    const { refreshJwt } = await issueSession(decoded.userId, req)

    res.cookie(REFRESH_COOKIE, refreshJwt, refreshCookieOptions())
    res.json({ accessToken: await signAccessToken(claims), user: claims, expiresIn: env.ACCESS_TTL_MIN * 60 })
  }),
)

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]
    if (token) {
      const decoded = await verifyRefreshJwt(token)
      if (decoded) await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, decoded.tokenId))
    }
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined })
    res.json({ ok: true })
  }),
)

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const claims = await buildClaims(req.auth!.sub)
    if (!claims) throw unauthorized()
    res.json({ user: claims })
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
    await db.update(users).set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() }).where(eq(users.id, user.id))
    // Force every other device to re-authenticate.
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, user.id))
    await audit(req, { action: 'change_password', entity: 'user', entityId: user.id })
    res.json({ ok: true })
  }),
)

authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({ id: refreshTokens.id, userAgent: refreshTokens.userAgent, ip: refreshTokens.ip, createdAt: refreshTokens.createdAt, revokedAt: refreshTokens.revokedAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, req.auth!.sub))
      .orderBy(desc(refreshTokens.createdAt))
      .limit(20)
    res.json({ data: rows })
  }),
)
