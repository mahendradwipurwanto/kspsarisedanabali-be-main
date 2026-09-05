import { env } from './env.js'

export interface RevalidateResult {
  /** False when the website was not refreshed and is still serving the old copy. */
  ok: boolean
  /** Something an editor can act on, in Indonesian. Absent when ok. */
  reason?: string
}

/**
 * Tell the landing page to drop its cached copies.
 *
 * Never fails the editor's save — the ISR window catches up eventually — but it
 * does report what happened, because "tersimpan" with nothing changing on the
 * website is the most confusing outcome this system can produce. A menu moved
 * in the console and unchanged on the site for twenty minutes is a
 * misconfiguration, not a slow cache, and the editor should be told which.
 */
export async function revalidateLp(tags: string[]): Promise<RevalidateResult> {
  if (!env.LP_REVALIDATE_URL || !env.REVALIDATE_SECRET) {
    const missing = !env.LP_REVALIDATE_URL ? 'LP_REVALIDATE_URL' : 'REVALIDATE_SECRET'
    console.warn(`revalidate dilewati: ${missing} belum diatur`)
    return { ok: false, reason: `${missing} belum diatur di server API, sehingga website tidak diberi tahu.` }
  }

  try {
    const res = await fetch(env.LP_REVALIDATE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': env.REVALIDATE_SECRET },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) return { ok: true }

    const reason =
      res.status === 401
        ? 'REVALIDATE_SECRET di server API berbeda dengan yang dipakai website.'
        : `Website menjawab ${res.status} saat diminta menyegarkan halaman.`
    console.warn(`revalidate ditolak: ${res.status} dari ${env.LP_REVALIDATE_URL}`, tags)
    return { ok: false, reason }
  } catch (err) {
    console.warn(`revalidate tidak terjangkau di ${env.LP_REVALIDATE_URL}`, tags, (err as Error).message)
    return {
      ok: false,
      reason: `Website tidak menjawab di ${env.LP_REVALIDATE_URL}. Periksa alamatnya di pengaturan server API.`,
    }
  }
}
