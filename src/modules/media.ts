import express, { Router } from 'express'
import { and, desc, eq, ilike, count } from 'drizzle-orm'
import { presignSchema, confirmMediaSchema } from '../contracts/index.js'
import { db, media, mediaFolders } from '../db/index.js'
import { presignUpload, presignDownload, publicUrl, deleteObjects, putObject, PRIVATE_FOLDERS } from '../lib/storage.js'
import { asyncHandler, validate, requireAuth, requirePermission, notFound, audit, validated, param, ApiError } from '../middleware/index.js'

export const mediaRouter: Router = Router()
mediaRouter.use(requireAuth)

/**
 * Upload flow: presign → browser PUTs straight to object storage → confirm.
 * The file never passes through this function, so Vercel's 4.5 MB body limit
 * does not apply. Verified end-to-end against Cloudeka on 10 Aug 2026.
 */
mediaRouter.post(
  '/presign',
  requirePermission('media:upload'),
  validate(presignSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('zod').infer<typeof presignSchema>
    const presigned = await presignUpload(body)
    res.json({ data: presigned })
  }),
)

mediaRouter.post(
  '/confirm',
  requirePermission('media:upload'),
  validate(confirmMediaSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as import('zod').infer<typeof confirmMediaSchema>
    const folder = body.key.split('/')[0] ?? 'media'

    const [row] = await db
      .insert(media)
      .values({
        key: body.key,
        filename: body.filename,
        contentType: body.contentType,
        size: body.size,
        width: body.width ?? null,
        height: body.height ?? null,
        alt: body.alt || null,
        caption: body.caption || null,
        folderId: body.folderId ?? null,
        isPrivate: PRIVATE_FOLDERS.has(folder),
        uploadedById: req.auth!.sub,
      })
      .returning()

    await audit(req, { action: 'upload', entity: 'media', entityId: row!.id, summary: body.filename })
    res.status(201).json({ data: { ...row, url: publicUrl(row!.key) } })
  }),
)

mediaRouter.get(
  '/',
  requirePermission('media:read'),
  asyncHandler(async (req, res) => {
    const q = validated<Record<string, string>>(req)
    const page = Math.max(Number(q.page ?? 1), 1)
    const limit = Math.min(Number(q.limit ?? 40), 100)
    const where = and(
      q.q ? ilike(media.filename, `%${q.q}%`) : undefined,
      q.folderId ? eq(media.folderId, q.folderId) : undefined,
    )
    const [{ total }] = await db.select({ total: count() }).from(media).where(where)
    const rows = await db.select().from(media).where(where).orderBy(desc(media.createdAt)).limit(limit).offset((page - 1) * limit)

    res.json({
      data: rows.map((r) => ({ ...r, url: publicUrl(r.key) })),
      meta: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
      /** Surfaces "gambar belum punya keterangan" in the media library UI. */
      missingAlt: rows.filter((r) => !r.alt).length,
    })
  }),
)

/**
 * Upload through the API.
 *
 * The browser cannot PUT straight to the bucket until it carries a CORS rule,
 * so the console posts the bytes here and the server writes them. The body
 * limit is set on this route alone, so ordinary JSON routes stay small.
 */
mediaRouter.post(
  '/upload',
  requirePermission('media:upload'),
  express.raw({ type: () => true, limit: '25mb' }),
  asyncHandler(async (req, res) => {
    const filename = String(req.header('x-filename') ?? '').trim()
    const folder = String(req.header('x-folder') ?? 'media')
    const contentType = req.header('content-type') ?? 'application/octet-stream'
    if (!filename) throw new ApiError(400, 'Header x-filename wajib diisi.', 'missing_filename')
    if (!['media', 'documents'].includes(folder)) throw new ApiError(400, 'Folder tidak dikenal.', 'bad_folder')
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ApiError(400, 'Berkas kosong.', 'empty_file')

    const saved = await putObject({ folder, filename, contentType, body: req.body })
    await audit(req, { action: 'upload', entity: 'media', summary: saved.key })
    res.json({ data: saved })
  }),
)

mediaRouter.patch(
  '/:id',
  requirePermission('media:upload'),
  asyncHandler(async (req, res) => {
    // A PATCH must touch only the keys it carries. Setting every column from a
    // partial body wiped the alt text whenever the caption alone was edited.
    const body = req.body as { alt?: string; caption?: string; folderId?: string | null }
    const patch: Partial<typeof media.$inferInsert> = {}
    if ('alt' in body) patch.alt = body.alt || null
    if ('caption' in body) patch.caption = body.caption || null
    if ('folderId' in body) patch.folderId = body.folderId ?? null
    if (!Object.keys(patch).length) throw new ApiError(400, 'Tidak ada perubahan yang dikirim.', 'empty_patch')

    const [row] = await db
      .update(media)
      .set(patch)
      .where(eq(media.id, param(req, 'id')))
      .returning()
    if (!row) throw notFound('Berkas tidak ditemukan.')
    res.json({ data: { ...row, url: publicUrl(row.key) } })
  }),
)

mediaRouter.delete(
  '/:id',
  requirePermission('media:delete'),
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(media).where(eq(media.id, param(req, 'id'))).limit(1)
    if (!row) throw notFound('Berkas tidak ditemukan.')
    await deleteObjects([row.key]).catch((e) => console.warn('storage delete failed', e))
    await db.delete(media).where(eq(media.id, row.id))
    await audit(req, { action: 'delete', entity: 'media', entityId: row.id, summary: row.filename })
    res.json({ ok: true })
  }),
)

/** Signed URL for private objects (applicant CVs, internal documents). */
mediaRouter.get(
  '/:id/signed-url',
  requirePermission('media:read', 'jobs:applications'),
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(media).where(eq(media.id, param(req, 'id'))).limit(1)
    if (!row) throw notFound('Berkas tidak ditemukan.')
    res.json({ data: { url: await presignDownload(row.key, 300), expiresIn: 300 } })
  }),
)

mediaRouter.get(
  '/folders',
  requirePermission('media:read'),
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(mediaFolders)
    res.json({ data: rows })
  }),
)

mediaRouter.post(
  '/folders',
  requirePermission('media:upload'),
  asyncHandler(async (req, res) => {
    const body = req.body as { name: string; parentId?: string }
    const [row] = await db.insert(mediaFolders).values({ name: body.name, parentId: body.parentId ?? null }).returning()
    res.status(201).json({ data: row })
  }),
)
