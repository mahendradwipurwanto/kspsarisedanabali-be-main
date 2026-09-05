import { env } from './env.js'

/**
 * Tell the landing page to drop its cached copies. Fire-and-forget: a failed
 * revalidation must never fail the editor's save — the ISR window will catch up.
 */
export async function revalidateLp(tags: string[]) {
  if (!env.LP_REVALIDATE_URL || !env.REVALIDATE_SECRET) return
  try {
    const res = await fetch(env.LP_REVALIDATE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': env.REVALIDATE_SECRET },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5000),
    })
    // A rejected call used to pass silently: the console told the editor the
    // website had been updated while the request was being turned away, and the
    // change only appeared when the ISR window expired minutes later.
    if (!res.ok) {
      console.warn(
        `revalidate rejected: ${res.status} from ${env.LP_REVALIDATE_URL}` +
        (res.status === 401 ? ' — REVALIDATE_SECRET here does not match the one the website expects' : ''),
        tags,
      )
    }
  } catch (err) {
    console.warn(`revalidate unreachable at ${env.LP_REVALIDATE_URL}`, tags, (err as Error).message)
  }
}
