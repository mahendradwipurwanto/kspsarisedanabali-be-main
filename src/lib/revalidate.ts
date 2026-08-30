import { env } from './env.js'

/**
 * Tell the landing page to drop its cached copies. Fire-and-forget: a failed
 * revalidation must never fail the editor's save — the ISR window will catch up.
 */
export async function revalidateLp(tags: string[]) {
  if (!env.LP_REVALIDATE_URL || !env.REVALIDATE_SECRET) return
  try {
    await fetch(env.LP_REVALIDATE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': env.REVALIDATE_SECRET },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (err) {
    console.warn('revalidate failed', tags, (err as Error).message)
  }
}
