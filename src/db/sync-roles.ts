import 'dotenv/config'

import { eq } from 'drizzle-orm'
import { SYSTEM_ROLES, PERMISSION_LIST, type SystemRoleKey } from '../contracts/index.js'
import { db, sqlClient } from './index.js'
import * as t from './schema.js'

/**
 * Bring the seeded roles back in line with the permission registry.
 *
 * Adding a permission to the contract does not reach a database that was
 * seeded before it existed: the role rows keep the list they were given, so a
 * Super Admin gets a 403 on the new screen. The full seed would fix it, but it
 * also rewrites pages and settings, which is not something to run against a
 * site someone has been editing.
 *
 * This touches the `roles` table only, and only the roles the contract owns:
 *
 *   npm run db:sync-roles          # add newly-declared permissions
 *   npm run db:sync-roles -- --prune   # also drop ones no longer declared
 *
 * Custom roles made in the console are never touched.
 */
const prune = process.argv.includes('--prune')

async function main() {
  console.log(`→ syncing system role permissions${prune ? ' (pruning removed ones)' : ''}…`)
  let changed = 0

  for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
    const [row] = await db
      .select({ id: t.roles.id, permissions: t.roles.permissions })
      .from(t.roles)
      .where(eq(t.roles.key, key))
      .limit(1)

    if (!row) {
      await db.insert(t.roles).values({
        key,
        name: role.name,
        description: role.description,
        permissions: [...role.permissions],
        isLocked: (role as { locked?: boolean }).locked ?? false,
      })
      console.log(`  + ${key}: created with ${role.permissions.length} permissions`)
      changed++
      continue
    }

    const current = row.permissions ?? []
    const wanted = role.permissions as readonly string[]
    // Anything an administrator added by hand in the console is kept unless
    // --prune says otherwise, so this can be run safely on a live database.
    const next = prune
      ? [...wanted]
      : [...new Set([...current, ...wanted])].filter((p) => PERMISSION_LIST.includes(p as never))

    const added = next.filter((p) => !current.includes(p))
    const removed = current.filter((p) => !next.includes(p))
    if (!added.length && !removed.length) continue

    await db.update(t.roles).set({ permissions: next, updatedAt: new Date() }).where(eq(t.roles.id, row.id))
    console.log(`  ~ ${key}: ${added.length ? `+${added.join(', +')}` : ''}${added.length && removed.length ? ' | ' : ''}${removed.length ? `-${removed.join(', -')}` : ''}`)
    changed++
  }

  console.log(changed ? `✓ ${changed} role(s) updated` : '✓ already in sync')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => sqlClient.end())

export type { SystemRoleKey }
