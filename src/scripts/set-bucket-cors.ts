import 'dotenv/config'
import { corsOrigins, env } from '../lib/env.js'
import { getBucketCors, mergeCorsRules, putBucketCors } from '../lib/storage.js'

/**
 * Applies the bucket's CORS rule from CORS_ORIGINS.
 *
 * Run it again after adding a domain to CORS_ORIGINS. Our rule is rewritten from
 * that list; rules belonging to anyone else, such as the hosting panel's own, are
 * left alone.
 *
 *   npm run storage:cors            # apply
 *   npm run storage:cors -- --show  # print the current rule and stop
 */
async function main() {
  const show = process.argv.includes('--show')

  console.log(`bucket   ${env.STORAGE_BUCKET}`)
  console.log(`endpoint ${env.STORAGE_ENDPOINT}`)

  const before = await getBucketCors()
  console.log(`\naturan saat ini: ${before.length ? JSON.stringify(before, null, 2) : '(belum ada)'}`)
  if (show) return

  if (!corsOrigins.length) {
    throw new Error('CORS_ORIGINS kosong; isi dulu sebelum menerapkan aturan')
  }

  await putBucketCors(mergeCorsRules(before, corsOrigins))

  const after = await getBucketCors()
  console.log(`\naturan baru: ${JSON.stringify(after, null, 2)}`)
  console.log(`\nasal yang diizinkan: ${corsOrigins.join(', ')}`)
}

main().catch((err) => {
  console.error(`\ngagal: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
