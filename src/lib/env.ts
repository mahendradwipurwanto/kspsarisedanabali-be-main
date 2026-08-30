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

if (env.NODE_ENV === 'production' && env.DATABASE_SSL !== 'require') {
  console.warn(
    '⚠  DATABASE_SSL is not "require" — the database link is UNENCRYPTED. ' +
      'See PROJECT-PLAN.md Blocker 1. Do not store real member data until this is resolved.',
  )
}
