import 'dotenv/config'
import { eq, sql } from 'drizzle-orm'
import { db, sqlClient } from './index.js'
import * as t from './schema.js'
import { hashPassword } from '../lib/auth.js'

const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@sarisedanabali.co.id').toLowerCase()
const password = process.env.RESET_ADMIN_PASSWORD

if (!password || password.length < 10) {
  throw new Error('RESET_ADMIN_PASSWORD must be provided and contain at least 10 characters.')
}

try {
  const passwordHash = await hashPassword(password)
  const [existing] = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(sql`lower(${t.users.email}) = ${email}`)
    .limit(1)

  let userId = existing?.id
  if (userId) {
    await db.update(t.users).set({ passwordHash, isActive: true, deletedAt: null, updatedAt: new Date() }).where(eq(t.users.id, userId))
  } else {
    const [created] = await db
      .insert(t.users)
      .values({ name: 'Administrator', email, passwordHash, isActive: true })
      .returning({ id: t.users.id })
    userId = created!.id
  }

  const [superAdmin] = await db.select({ id: t.roles.id }).from(t.roles).where(eq(t.roles.key, 'super_admin')).limit(1)
  if (!superAdmin) throw new Error('The super_admin role does not exist. Run the database seed first.')

  await db.insert(t.userRoles).values({ userId, roleId: superAdmin.id }).onConflictDoNothing()
  await db.update(t.refreshTokens).set({ revokedAt: new Date() }).where(eq(t.refreshTokens.userId, userId))

  console.log(`Admin credentials reset for ${email}. Existing sessions were revoked.`)
} finally {
  await sqlClient.end()
}
