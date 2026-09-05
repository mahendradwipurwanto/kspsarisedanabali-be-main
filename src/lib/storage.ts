import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  type CORSRule,
} from '@aws-sdk/client-s3'
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

/**
 * Upload from the server.
 *
 * The presigned-PUT flow needs a CORS rule on the bucket allowing the console's
 * origin; without one the browser refuses the request before it is sent. This
 * takes the bytes through the API instead, which no browser policy can block.
 */
export async function putObject(opts: { folder: string; filename: string; contentType: string; body: Buffer }) {
  const allowed = ALLOWED_BY_FOLDER[opts.folder] ?? ALLOWED_IMAGE
  if (!allowed.includes(opts.contentType)) {
    throw Object.assign(new Error(`Tipe berkas ${opts.contentType} tidak diizinkan`), { status: 400 })
  }
  const key = buildKey(opts.folder, opts.filename)
  await s3.send(new PutObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key, ContentType: opts.contentType, Body: opts.body }))
  return { key, size: opts.body.length }
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

/**
 * CORS rules for the bucket.
 *
 * Without a rule the browser refuses a presigned PUT before it is sent, so every
 * upload from the console and every CV on the careers form fails with nothing but
 * a CORS error in the console; the same request from Node succeeds, which is how
 * it went unnoticed until Sep 2026. Uploads now go through the API either way,
 * but a rule restores the direct path, which is the better one for large files.
 *
 * The allowed origins are `corsOrigins`, the same list the API itself trusts, so
 * there is one place to add a domain rather than two that can drift apart.
 */
export function bucketCorsRules(origins: string[]): CORSRule[] {
  return [
    {
      AllowedOrigins: origins,
      AllowedMethods: ['GET', 'HEAD', 'PUT'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    },
  ]
}

export async function getBucketCors(): Promise<CORSRule[]> {
  try {
    const res = await s3.send(new GetBucketCorsCommand({ Bucket: env.STORAGE_BUCKET }))
    return res.CORSRules ?? []
  } catch (err) {
    const code = (err as { name?: string }).name ?? ''
    if (code === 'NoSuchCORSConfiguration' || code === 'NoSuchCORSConfigurationError') return []
    throw err
  }
}

export async function putBucketCors(rules: CORSRule[]) {
  await s3.send(new PutBucketCorsCommand({ Bucket: env.STORAGE_BUCKET, CORSConfiguration: { CORSRules: rules } }))
}

/**
 * The rule the hosting panel keeps for its own file browser.
 *
 * PutBucketCors replaces the whole configuration, so the first run of
 * `npm run storage:cors` wrote our rule over this one. It is re-added when no
 * rule covers the panel's origin, which repairs that and keeps a later run from
 * doing the same damage twice.
 */
const PANEL_CORS_RULE: CORSRule = {
  AllowedOrigins: ['https://sumopod.com'],
  AllowedMethods: ['GET', 'PUT', 'DELETE', 'POST', 'HEAD'],
  AllowedHeaders: ['*'],
}

/** Our rule, plus every rule that belongs to someone else. Ours is the one whose origins we all manage. */
export function mergeCorsRules(existing: CORSRule[], origins: string[]): CORSRule[] {
  const managed = new Set(origins)
  const foreign = existing.filter((r) => !(r.AllowedOrigins ?? []).every((o) => managed.has(o)))
  const covered = (origin: string) => foreign.some((r) => (r.AllowedOrigins ?? []).includes(origin))
  const panel = covered('https://sumopod.com') ? [] : [PANEL_CORS_RULE]
  return [...foreign, ...panel, ...bucketCorsRules(origins)]
}
