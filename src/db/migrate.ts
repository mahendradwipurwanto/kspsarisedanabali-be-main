import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

/**
 * Migrations run through the same :6432 listener as the app — SumoPod exposes no
 * direct 5432 port. Verified safe: the listener is session-pooled and honours
 * advisory locks, which is what the Drizzle migrator needs.
 */
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

const client = postgres(url, {
  max: 1,
  ssl: process.env.DATABASE_SSL === 'require' ? 'require' : 'prefer',
  onnotice: () => {},
})

const db = drizzle(client)

console.log('→ running migrations…')
await migrate(db, { migrationsFolder: './drizzle' })
console.log('✓ migrations complete')
await client.end()
