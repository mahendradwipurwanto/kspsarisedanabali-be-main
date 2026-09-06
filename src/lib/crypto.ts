import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from './env.js'

/*
 * The small set of primitives the auth layer needs, on Node's own crypto so
 * nothing native has to build on the deploy target.
 */

/* ------------------------------ sealing at rest ------------------------------ */

/** 32-byte AES key: the configured one, or in development one derived from the refresh secret. */
const dataKey = createHash('sha256').update(env.DATA_ENCRYPTION_KEY || `derived:${env.JWT_REFRESH_SECRET}`).digest()

/** AES-256-GCM. Output is `v1.<iv>.<tag>.<ciphertext>` in base64url; `null` in, `null` out. */
export function seal(plain: string | null | undefined): string | null {
  if (plain == null) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`
}

export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null
  const [v, iv, tag, body] = sealed.split('.')
  if (v !== 'v1' || !iv || !tag || !body) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export const sha256 = (input: string | Buffer) => createHash('sha256').update(input).digest('hex')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

/* ----------------------------------- TOTP ----------------------------------- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

/** A fresh 20-byte secret, base32 for the authenticator app. */
export const generateTotpSecret = () => base32Encode(randomBytes(20))

export function totpUri(secret: string, account: string, issuer: string) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', secret).update(msg).digest()
  const offset = digest[digest.length - 1]! & 0xf
  const code = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!
  return String(code % 1_000_000).padStart(6, '0')
}

/**
 * RFC 6238, 30-second steps, one step of drift either way for slow clocks.
 * Returns the matched step so a code cannot be accepted twice inside its window.
 */
export function verifyTotp(secret: string, code: string, lastUsedStep = -1): number | null {
  const digits = code.replace(/\D/g, '')
  if (digits.length !== 6) return null
  const key = base32Decode(secret)
  const step = Math.floor(Date.now() / 30_000)
  for (const delta of [0, -1, 1]) {
    const s = step + delta
    if (s <= lastUsedStep) continue
    const expected = hotp(key, s)
    if (expected.length === digits.length && timingSafeEqual(Buffer.from(expected), Buffer.from(digits))) return s
  }
  return null
}

/* ------------------------------ recovery codes ------------------------------ */

/** Ten codes of the form xxxx-xxxx-xxxx, shown once; only their hashes are kept. */
export function generateRecoveryCodes(count = 10): { plain: string[]; hashes: string[] } {
  const plain: string[] = []
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').toLowerCase().slice(0, 12)
    plain.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`)
  }
  return { plain, hashes: plain.map(hashRecoveryCode) }
}

export const hashRecoveryCode = (code: string) => sha256(`recovery:${code.toLowerCase().replace(/[^a-z0-9]/g, '')}`)

/* ------------------------------ request signing ----------------------------- */

/**
 * The string both sides sign: method, the path with its query, the client's
 * timestamp (ms), a nonce, and the SHA-256 of the raw body. Keeping the body
 * hash rather than the body means a 5 MB upload still signs in one line.
 */
export function canonicalRequest(method: string, pathWithQuery: string, ts: string, nonce: string, bodyHash: string) {
  return `${method.toUpperCase()}\n${pathWithQuery}\n${ts}\n${nonce}\n${bodyHash}`
}

export function signRequest(key: string, canonical: string) {
  return createHmac('sha256', key).update(canonical).digest('base64url')
}

export function signaturesMatch(a: string, b: string) {
  const ba = Buffer.from(a), bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/**
 * Nonces seen inside the signature window, per process. Serverless instances
 * do not share it, so the timestamp window is the hard guarantee and this is
 * the belt on top of it.
 */
const seen = new Map<string, number>()
export function nonceIsFresh(sessionId: string, nonce: string, windowMs: number): boolean {
  const now = Date.now()
  if (seen.size > 5000) for (const [k, t] of seen) if (t < now - windowMs) seen.delete(k)
  const key = `${sessionId}:${nonce}`
  if (seen.has(key)) return false
  seen.set(key, now)
  return true
}

/** "Chrome · Windows" from a user agent, for the sessions list. */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent || ''
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Perangkat'
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${browser} · ${os}`
}

/* ------------------------------ MFA challenges ------------------------------ */

/**
 * A login challenge may be redeemed once. The registry is in memory, sized by
 * the challenge lifetime; a restart forgets it, which only ever re-opens a
 * window of a few minutes for a challenge that also needs a fresh code.
 */
const usedChallenges = new Map<string, number>()
export function consumeChallenge(jti: string, ttlMs = 6 * 60_000): boolean {
  const now = Date.now()
  for (const [k, exp] of usedChallenges) if (exp < now) usedChallenges.delete(k)
  if (usedChallenges.has(jti)) return false
  usedChallenges.set(jti, now + ttlMs)
  return true
}
