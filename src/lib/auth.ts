import { randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify, EncryptJWT, jwtDecrypt } from 'jose'
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
/** The refresh cookie is encrypted, not merely signed: 32 bytes derived from the refresh secret. */
const refreshKey = createHash('sha256').update(`refresh-jwe:${env.JWT_REFRESH_SECRET}`).digest()
const challengeKey = new TextEncoder().encode(`mfa-challenge:${env.JWT_ACCESS_SECRET}`)

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_COST)
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash)

export interface AccessClaims {
  sub: string
  name: string
  email: string
  permissions: string[]
  branchIds: string[]
  roles: string[]
  /** The session this token belongs to; revoking the session kills the token at once. */
  sid?: string
  /** Second factor passed on this session. */
  mfa?: boolean
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

/**
 * The refresh cookie: an encrypted token (JWE, A256GCM) carrying the session row
 * id and the raw refresh secret. Encrypted rather than signed so nothing about
 * the session — not even its id — can be read off the cookie.
 */
export async function sealRefreshCookie(userId: string, tokenId: string, raw: string) {
  return new EncryptJWT({ tid: tokenId, rt: raw })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env.REFRESH_TTL_DAYS}d`)
    .encrypt(refreshKey)
}

export async function openRefreshCookie(token: string) {
  try {
    const { payload } = await jwtDecrypt(token, refreshKey)
    return { userId: payload.sub as string, tokenId: payload.tid as string, raw: payload.rt as string }
  } catch {
    return null
  }
}

/** Between the password and the second factor: five minutes, one purpose, nothing else it can do. */
export async function signMfaChallenge(userId: string) {
  return new SignJWT({ purpose: 'mfa' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(challengeKey)
}

export async function verifyMfaChallenge(token: string): Promise<{ userId: string; jti: string } | null> {
  try {
    const { payload } = await jwtVerify(token, challengeKey)
    return payload.purpose === 'mfa' && typeof payload.sub === 'string' && typeof payload.jti === 'string' ? { userId: payload.sub, jti: payload.jti } : null
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
