import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    // SumoPod's listener refuses TLS today — see PROJECT-PLAN.md Blocker 1.
    ssl: process.env.DATABASE_SSL === 'require' ? 'require' : false,
  },
  verbose: true,
  strict: true,
} satisfies Config
