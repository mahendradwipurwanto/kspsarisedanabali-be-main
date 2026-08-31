import { Router } from 'express'
import { and, asc, desc, eq, isNull, ne, sql, count } from 'drizzle-orm'
import { createUserSchema, updateUserSchema, roleSchema, PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LIST } from '../contracts/index.js'
import { db, users, roles, userRoles, userBranches, branches, refreshTokens, auditLogs } from '../db/index.js'
import { hashPassword } from '../lib/auth.js'
import { asyncHandler, validate, requireAuth, requirePermission, notFound, ApiError, audit, validated, param } from '../middleware/index.js'

export const userRouter: Router = Router()
export const roleRouter: Router = Router()

userRouter.use(requireAuth)
roleRouter.use(requireAuth)

/* ----------------------------------- users --------------------------------- */

async function hydrate(userId: string) {
  const [roleRows, branchRows] = await Promise.all([
    db.select({ id: roles.id, key: roles.key, name: roles.name }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId)),
    db.select({ id: branches.id, name: branches.name }).from(userBranches).innerJoin(branches, eq(branches.id, userBranches.branchId)).where(eq(userBranches.userId, userId)),
  ])
  return { roles: roleRows, branches: branchRows }
}

userRouter.get(
  '/',
  requirePermission('users:read'),
  asyncHandler(async (req, res) => {
    const q = validated<Record<string, string>>(req)
    const page = Math.max(Number(q.page ?? 1), 1)
    const limit = Math.min(Number(q.limit ?? 50), 100)
    const where = isNull(users.deletedAt)

    const [{ total }] = await db.select({ total: count() }).from(users).where(where)
    const rows = await db
      .select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset((page - 1) * limit)

    const hydrated = await Promise.all(rows.map(async (u) => ({ ...u, ...(await hydrate(u.id)) })))
    res.json({ data: hydrated, meta: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) } })
  }),
)

userRouter.post(
  '/',
  requirePermission('users:write'),
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('zod').infer<typeof createUserSchema>

    const [row] = await db
      .insert(users)
      .values({
        name: body.name,
        email: body.email.toLowerCase(),
        passwordHash: await hashPassword(body.password),
        isActive: body.isActive ?? true,
      })
      .returning({ id: users.id, name: users.name, email: users.email })

    await db.insert(userRoles).values(body.roleIds.map((roleId) => ({ userId: row!.id, roleId })))
    if (body.branchIds?.length) {
      await db.insert(userBranches).values(body.branchIds.map((branchId) => ({ userId: row!.id, branchId })))
    }

    await audit(req, { action: 'create', entity: 'user', entityId: row!.id, summary: body.email })
    res.status(201).json({ data: { ...row, ...(await hydrate(row!.id)) } })
  }),
)

userRouter.patch(
  '/:id',
  requirePermission('users:write'),
  validate(updateUserSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('zod').infer<typeof updateUserSchema>
    const [existing] = await db.select().from(users).where(and(eq(users.id, param(req, 'id')), isNull(users.deletedAt))).limit(1)
    if (!existing) throw notFound('Pengguna tidak ditemukan.')

    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name) patch.name = body.name
    if (body.email) patch.email = body.email.toLowerCase()
    if (body.isActive !== undefined) patch.isActive = body.isActive
    if (body.password) patch.passwordHash = await hashPassword(body.password)

    await db.update(users).set(patch).where(eq(users.id, existing.id))

    if (body.roleIds) {
      // Never let the last Super Admin lose the role — that would lock everyone out.
      await assertNotLastSuperAdmin(existing.id, body.roleIds)
      await db.delete(userRoles).where(eq(userRoles.userId, existing.id))
      if (body.roleIds.length) await db.insert(userRoles).values(body.roleIds.map((roleId) => ({ userId: existing.id, roleId })))
    }
    if (body.branchIds) {
      await db.delete(userBranches).where(eq(userBranches.userId, existing.id))
      if (body.branchIds.length) await db.insert(userBranches).values(body.branchIds.map((branchId) => ({ userId: existing.id, branchId })))
    }
    // Permissions changed → existing access tokens are stale. Force a refresh.
    if (body.roleIds || body.branchIds || body.isActive === false || body.password) {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, existing.id))
    }

    await audit(req, { action: 'update', entity: 'user', entityId: existing.id })
    res.json({ data: { id: existing.id, ...(await hydrate(existing.id)) } })
  }),
)

async function assertNotLastSuperAdmin(userId: string, nextRoleIds: string[]) {
  const [superRole] = await db.select().from(roles).where(eq(roles.key, 'super_admin')).limit(1)
  if (!superRole) return
  const hadSuper = await db
    .select({ n: count() })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, superRole.id)))
  if (Number(hadSuper[0]!.n) === 0) return
  if (nextRoleIds.includes(superRole.id)) return

  const [{ n }] = await db
    .select({ n: count() })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.roleId, superRole.id), ne(userRoles.userId, userId), isNull(users.deletedAt), eq(users.isActive, true)))

  if (Number(n) === 0) {
    throw new ApiError(400, 'Ini satu-satunya Super Admin yang aktif. Tunjuk Super Admin lain terlebih dahulu.', 'last_super_admin')
  }
}

userRouter.delete(
  '/:id',
  requirePermission('users:delete'),
  asyncHandler(async (req, res) => {
    if (param(req, 'id') === req.auth!.sub) throw new ApiError(400, 'Anda tidak bisa menghapus akun sendiri.', 'self_delete')
    await assertNotLastSuperAdmin(param(req, 'id'), [])
    await db.update(users).set({ deletedAt: new Date(), isActive: false }).where(eq(users.id, param(req, 'id')))
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, param(req, 'id')))
    await audit(req, { action: 'delete', entity: 'user', entityId: param(req, 'id') })
    res.json({ ok: true })
  }),
)

/* ----------------------------------- roles --------------------------------- */

roleRouter.get(
  '/permissions',
  requirePermission('roles:read', 'roles:manage'),
  asyncHandler(async (_req, res) => {
    res.json({ data: { groups: PERMISSION_GROUPS, descriptions: PERMISSIONS } })
  }),
)

roleRouter.get(
  '/',
  requirePermission('roles:read', 'roles:manage', 'users:read'),
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({
        id: roles.id, key: roles.key, name: roles.name, description: roles.description,
        permissions: roles.permissions, isLocked: roles.isLocked,
        userCount: sql<number>`(select count(*)::int from user_roles ur where ur.role_id = ${roles.id})`,
      })
      .from(roles)
      .orderBy(asc(roles.name))
    res.json({ data: rows })
  }),
)

roleRouter.post(
  '/',
  requirePermission('roles:manage'),
  validate(roleSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('zod').infer<typeof roleSchema>
    const unknown = body.permissions.filter((p) => !PERMISSION_LIST.includes(p as never))
    if (unknown.length) throw new ApiError(422, `Hak akses tidak dikenal: ${unknown.join(', ')}`, 'unknown_permission')

    const key = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
    const [row] = await db
      .insert(roles)
      .values({ key: `${key}_${Date.now().toString(36)}`, name: body.name, description: body.description || null, permissions: body.permissions })
      .returning()

    await audit(req, { action: 'create', entity: 'role', entityId: row!.id, summary: body.name })
    res.status(201).json({ data: row })
  }),
)

roleRouter.patch(
  '/:id',
  requirePermission('roles:manage'),
  validate(roleSchema.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<import('zod').infer<typeof roleSchema>>
    const [existing] = await db.select().from(roles).where(eq(roles.id, param(req, 'id'))).limit(1)
    if (!existing) throw notFound('Peran tidak ditemukan.')

    if (existing.isLocked && body.permissions) {
      throw new ApiError(400, 'Hak akses peran ini dikunci dan tidak bisa diubah.', 'role_locked')
    }
    if (body.permissions) {
      const unknown = body.permissions.filter((p) => !PERMISSION_LIST.includes(p as never))
      if (unknown.length) throw new ApiError(422, `Hak akses tidak dikenal: ${unknown.join(', ')}`, 'unknown_permission')
    }

    const [row] = await db
      .update(roles)
      .set({
        name: body.name ?? existing.name,
        description: body.description ?? existing.description,
        permissions: body.permissions ?? existing.permissions,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, existing.id))
      .returning()

    // Anyone holding this role now has stale permissions in their access token.
    const holders = await db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, existing.id))
    if (holders.length) {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(sql`${refreshTokens.userId} in ${holders.map((h) => h.userId)}`).catch(() => {})
    }

    await audit(req, { action: 'update', entity: 'role', entityId: existing.id, summary: row!.name })
    res.json({ data: row })
  }),
)

roleRouter.delete(
  '/:id',
  requirePermission('roles:manage'),
  asyncHandler(async (req, res) => {
    const [existing] = await db.select().from(roles).where(eq(roles.id, param(req, 'id'))).limit(1)
    if (!existing) throw notFound('Peran tidak ditemukan.')
    if (existing.isLocked) throw new ApiError(400, 'Peran sistem tidak bisa dihapus.', 'role_locked')

    const [{ n }] = await db.select({ n: count() }).from(userRoles).where(eq(userRoles.roleId, existing.id))
    if (Number(n) > 0) throw new ApiError(400, `Masih ada ${n} pengguna dengan peran ini. Pindahkan mereka dulu.`, 'role_in_use')

    await db.delete(roles).where(eq(roles.id, existing.id))
    await audit(req, { action: 'delete', entity: 'role', entityId: existing.id, summary: existing.name })
    res.json({ ok: true })
  }),
)

/* --------------------------------- audit log -------------------------------- */

export const auditRouter: Router = Router()
auditRouter.use(requireAuth)
auditRouter.get(
  '/',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const q = validated<Record<string, string>>(req)
    const limit = Math.min(Number(q.limit ?? 100), 200)
    const rows = await db
      .select({ log: auditLogs, userName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(q.entity ? eq(auditLogs.entity, q.entity) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
    res.json({ data: rows.map((r) => ({ ...r.log, userName: r.userName })) })
  }),
)
