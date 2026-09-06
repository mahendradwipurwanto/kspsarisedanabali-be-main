import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /**
   * The SumoPod listener currently refuses TLS (`ssl = off`) — see PROJECT-PLAN.md
   * Blocker 1. `prefer` is the only value that connects today; flip to `require`
   * the moment SumoPod enables it. Startup logs a warning while it is not `require`.
   */
  DATABASE_SSL: z.enum(['require', 'prefer', 'disable']).default('prefer'),
  DATABASE_PREPARE: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  ACCESS_TTL_MIN: z.coerce.number().default(15),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  /** Seals TOTP secrets and session signing keys at rest. 32+ chars; keep it out of git. */
  DATA_ENCRYPTION_KEY: z.string().default(''),
  /** A session that is not used for this long ends, whatever its remaining lifetime. */
  SESSION_IDLE_MIN: z.coerce.number().default(720),
  /** Signing in beyond this many live sessions ends the oldest one. */
  SESSION_MAX_PER_USER: z.coerce.number().default(5),
  /** Role keys that must have a second factor before they can work in the console. */
  MFA_REQUIRED_ROLES: z.string().default(''),
  /** `required`: every authenticated request must carry a valid signature; `optional`: verified when present; `off`. */
  REQUEST_SIGNING: z.enum(['required', 'optional', 'off']).default('required'),
  /** How far a signed request's timestamp may drift from the server clock. */
  SIGNATURE_WINDOW_SEC: z.coerce.number().default(120),

  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_REGION: z.string().default('kencana'),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  /** Public CDN base. Empty means the bucket is private → LP proxies images. */
  STORAGE_PUBLIC_URL: z.string().default(''),

  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
  LP_REVALIDATE_URL: z.string().default(''),
  REVALIDATE_SECRET: z.string().default(''),
  CRON_SECRET: z.string().default(''),
  TURNSTILE_SECRET: z.string().default(''),
  IP_HASH_SALT: z.string().default('ksp-local-salt'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('✗ Invalid environment configuration:')
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
  throw new Error('Environment validation failed')
}

export const env = parsed.data

export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
export const mfaRequiredRoles = env.MFA_REQUIRED_ROLES.split(',').map((s) => s.trim()).filter(Boolean)

if (!env.DATA_ENCRYPTION_KEY) {
  const message = 'DATA_ENCRYPTION_KEY is not set — TOTP secrets and session keys fall back to a key derived from JWT_REFRESH_SECRET.'
  if (env.NODE_ENV === 'production') throw new Error(message.replace(' fall back to', ' would fall back to') + ' Set it before deploying.')
  console.warn(`⚠  ${message}`)
}

if (env.NODE_ENV === 'production' && env.DATABASE_SSL !== 'require') {
  console.warn(
    '⚠  DATABASE_SSL is not "require" — the database link is UNENCRYPTED. ' +
      'See PROJECT-PLAN.md Blocker 1. Do not store real member data until this is resolved.',
  )
}
