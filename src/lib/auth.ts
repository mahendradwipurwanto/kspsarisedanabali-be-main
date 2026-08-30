import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import { env } from './env.js'

/**
 * bcryptjs (pure JS) rather than argon2 — no native binary, so it cannot fail on
 * the Vercel runtime. Cost 11 ≈ 100 ms, which is an acceptable login latency and
 * is fine against offline cracking for an admin panel of this size.
 */
const BCRYPT_COST = 11

const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET)
const refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET)

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_COST)
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash)

export interface AccessClaims {
  sub: string
  name: string
  email: string
  permissions: string[]
  branchIds: string[]
  roles: string[]
}

export async function signAccessToken(claims: AccessClaims) {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TTL_MIN}m`)
    .sign(accessKey)
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, accessKey)
    return payload as unknown as AccessClaims
  } catch {
    return null
  }
}

/**
 * Refresh tokens are opaque random strings; only their SHA-256 lives in the DB,
 * so a database read cannot mint a session. Rotated on every use.
 */
export function generateRefreshToken() {
  const raw = randomBytes(48).toString('base64url')
  return { raw, hash: hashToken(raw) }
}

export const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex')

export function hashIp(ip: string) {
  return createHash('sha256').update(ip + env.IP_HASH_SALT).digest('hex').slice(0, 32)
}

export async function signRefreshJwt(userId: string, tokenId: string) {
  return new SignJWT({ tid: tokenId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env.REFRESH_TTL_DAYS}d`)
    .sign(refreshKey)
}

export async function verifyRefreshJwt(token: string) {
  try {
    const { payload } = await jwtVerify(token, refreshKey)
    return { userId: payload.sub as string, tokenId: payload.tid as string }
  } catch {
    return null
  }
}

export const REFRESH_COOKIE = 'ksp_rt'

export const refreshCookieOptions = (maxAgeDays = env.REFRESH_TTL_DAYS) =>
  ({
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/v1/auth',
    maxAge: maxAgeDays * 24 * 60 * 60 * 1000,
  })
