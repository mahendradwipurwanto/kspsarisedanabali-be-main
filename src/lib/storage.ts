import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { ulid } from 'ulid'
import { env } from './env.js'

/**
 * Storage adapter. Probed against Cloudeka Deka Box on 10 Aug 2026:
 * path-style addressing, presigned PUT and GET both verified working.
 *
 * Everything goes through this interface so the provider can be swapped without
 * touching feature code.
 */
export interface PresignedUpload {
  url: string
  key: string
  method: 'PUT'
  headers: Record<string, string>
  expiresIn: number
}

const s3 = new S3Client({
  endpoint: env.STORAGE_ENDPOINT,
  region: env.STORAGE_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY },
})

const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml']
const ALLOWED_DOC = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']

export const ALLOWED_BY_FOLDER: Record<string, string[]> = {
  media: ALLOWED_IMAGE,
  documents: [...ALLOWED_DOC, ...ALLOWED_IMAGE],
  cv: ALLOWED_DOC,
}

/** `cv/*` holds applicants' personal data and must never be publicly readable. */
export const PRIVATE_FOLDERS = new Set(['cv'])

export function buildKey(folder: string, filename: string) {
  const now = new Date()
  const safe = filename
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : ''
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const prefix = folder === 'media' ? `media/${yyyy}/${mm}` : folder
  return `${prefix}/${ulid()}-${safe || 'file'}${ext}`
}

export async function presignUpload(opts: {
  folder: string
  filename: string
  contentType: string
  size: number
}): Promise<PresignedUpload> {
  const allowed = ALLOWED_BY_FOLDER[opts.folder] ?? ALLOWED_IMAGE
  if (!allowed.includes(opts.contentType)) {
    throw Object.assign(new Error(`Tipe berkas ${opts.contentType} tidak diizinkan`), { status: 400 })
  }
  const key = buildKey(opts.folder, opts.filename)
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key, ContentType: opts.contentType, ContentLength: opts.size }),
    { expiresIn: 600 },
  )
  return { url, key, method: 'PUT', headers: { 'Content-Type': opts.contentType }, expiresIn: 600 }
}

export const presignDownload = (key: string, expiresIn = 300) =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key }), { expiresIn })

export async function deleteObjects(keys: string[]) {
  if (!keys.length) return
  await s3.send({
    ...new DeleteObjectsCommand({ Bucket: env.STORAGE_BUCKET, Delete: { Objects: keys.map((Key) => ({ Key })) } }),
  } as DeleteObjectsCommand)
}

/**
 * Public URL for an object.
 *
 * While the bucket has no public-read policy (PROJECT-PLAN.md Blocker 4),
 * STORAGE_PUBLIC_URL is empty and we return a path the LP proxies through its own
 * `/api/media` route. Once the policy lands, set STORAGE_PUBLIC_URL and the same
 * call starts returning direct CDN URLs with no code change.
 */
export function publicUrl(key: string): string {
  if (!key) return ''
  if (key.startsWith('http')) return key
  if (PRIVATE_FOLDERS.has(key.split('/')[0] ?? '')) return `/api/media/${encodeURIComponent(key)}`
  return env.STORAGE_PUBLIC_URL ? `${env.STORAGE_PUBLIC_URL.replace(/\/$/, '')}/${key}` : `/api/media/${encodeURIComponent(key)}`
}

export const isStoragePublic = () => Boolean(env.STORAGE_PUBLIC_URL)
