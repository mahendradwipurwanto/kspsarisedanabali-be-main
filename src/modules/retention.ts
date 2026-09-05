import { Router, type RequestHandler } from 'express'
import { lte, lt, isNotNull, and, inArray } from 'drizzle-orm'
import { db, jobApplications, pageViews, events } from '../db/index.js'
import { asyncHandler, ApiError } from '../middleware/index.js'
import { deleteObjects } from '../lib/storage.js'
import { env } from '../lib/env.js'

/**
 * Deletes the personal data whose keeping time has run out.
 *
 * The privacy notice tells applicants their CV is removed twelve months after
 * they apply, and `job_applications.purge_after` has always carried that date —
 * but nothing ever read it, so nothing was ever deleted. A promise in a notice
 * has to be something the system actually does.
 *
 * Called on a schedule with the shared secret in `x-cron-secret`. Safe to run
 * as often as you like: it only ever acts on rows already past their date.
 */
export const retentionRouter: Router = Router()

/** Analytics rows are pseudonymous, and the daily rollups outlive them. */
const ANALYTICS_MONTHS = 24

const requireCronSecret: RequestHandler = (req, _res, next) => {
  if (!env.CRON_SECRET) throw new ApiError(503, 'CRON_SECRET belum diatur.', 'cron_not_configured')
  if (req.header('x-cron-secret') !== env.CRON_SECRET) throw new ApiError(401, 'Tidak berwenang.', 'unauthorized')
  next()
}

retentionRouter.post(
  '/retention',
  requireCronSecret,
  asyncHandler(async (_req, res) => {
    const now = new Date()
    const analyticsBefore = new Date(now)
    analyticsBefore.setMonth(analyticsBefore.getMonth() - ANALYTICS_MONTHS)

    const expired = await db
      .select({ id: jobApplications.id, cvKey: jobApplications.cvKey })
      .from(jobApplications)
      .where(and(isNotNull(jobApplications.purgeAfter), lte(jobApplications.purgeAfter, now)))

    // The file first: a row deleted before its object leaves the CV in the
    // bucket with nothing left pointing at it.
    const keys = expired.map((r) => r.cvKey).filter(Boolean)
    if (keys.length) await deleteObjects(keys)
    if (expired.length) {
      await db.delete(jobApplications).where(inArray(jobApplications.id, expired.map((r) => r.id)))
    }

    const views = await db.delete(pageViews).where(lt(pageViews.createdAt, analyticsBefore)).returning({ id: pageViews.id })
    const evts = await db.delete(events).where(lt(events.createdAt, analyticsBefore)).returning({ id: events.id })

    const result = {
      lamaranDihapus: expired.length,
      berkasCvDihapus: keys.length,
      kunjunganDihapus: views.length,
      peristiwaDihapus: evts.length,
      analitikSebelum: analyticsBefore.toISOString().slice(0, 10),
    }
    console.log('retensi dijalankan', result)
    res.json({ data: result })
  }),
)
