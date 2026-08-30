import express, { type Express } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { env, corsOrigins } from './lib/env.js'
import { attachIp, errorHandler, notFoundHandler, responseDeadline } from './middleware/index.js'
import { authRouter } from './modules/auth.js'
import { publicRouter } from './modules/public.js'
import { publicLeadRouter, leadRouter } from './modules/leads.js'
import { pageRouter } from './modules/pages.js'
import { mediaRouter } from './modules/media.js'
import { userRouter, roleRouter, auditRouter } from './modules/users.js'
import { trackRouter, analyticsRouter } from './modules/analytics.js'
import {
  productRouter, branchRouter, postRouter, postCategoryRouter, jobRouter, faqRouter,
  testimonialRouter, documentRouter, statRouter, redirectRouter, settingsRouter, menuRouter,
} from './modules/content.js'

/**
 * A cancelled statement (SQLSTATE 57014) rejects twice inside postgres.js: once
 * on the query promise the route awaits, and once on an orphan promise the
 * driver never attaches a handler to. Node's default is to abort the process on
 * that second rejection, so one slow query on the shared cluster took the whole
 * API down — observed while the SumoPod cluster was under load. Log and keep
 * serving: the request that triggered it has already been answered with a 500
 * by the error middleware, and other in-flight requests are unaffected.
 *
 * Registered once at module scope so both entrypoints get it — `src/server.ts`
 * locally and `api/index.ts` on a warm Vercel instance.
 */
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (process kept alive)', reason)
})

export function createApp(): Express {
  const app = express()

  // Vercel terminates TLS upstream; trust its forwarded headers for client IPs.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(
    helmet({
      contentSecurityPolicy: false, // this is a JSON API; the CSP that matters is on the LP
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  )
  app.use(
    cors({
      origin(origin, cb) {
        // Server-to-server calls (ISR, cron) arrive with no Origin header.
        if (!origin || corsOrigins.includes(origin)) return cb(null, true)
        cb(new Error(`Origin ${origin} tidak diizinkan`))
      },
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))
  app.use(cookieParser())
  app.use(attachIp)
  app.use(responseDeadline())

  app.get('/', (_req, res) => {
    res.json({ service: 'KSP Sari Sedana Bali API', version: '1.0.0', docs: '/v1/public/health' })
  })

  app.use('/v1/auth', authRouter)
  app.use('/v1/public', publicRouter)
  app.use('/v1/public', publicLeadRouter)
  app.use('/v1/track', trackRouter)

  app.use('/v1/pages', pageRouter)
  app.use('/v1/media', mediaRouter)
  app.use('/v1/leads', leadRouter)
  app.use('/v1/users', userRouter)
  app.use('/v1/roles', roleRouter)
  app.use('/v1/audit', auditRouter)
  app.use('/v1/analytics', analyticsRouter)

  app.use('/v1/products', productRouter)
  app.use('/v1/branches', branchRouter)
  app.use('/v1/posts', postRouter)
  app.use('/v1/post-categories', postCategoryRouter)
  app.use('/v1/jobs', jobRouter)
  app.use('/v1/faqs', faqRouter)
  app.use('/v1/testimonials', testimonialRouter)
  app.use('/v1/documents', documentRouter)
  app.use('/v1/stats', statRouter)
  app.use('/v1/redirects', redirectRouter)
  app.use('/v1/settings', settingsRouter)
  app.use('/v1/menus', menuRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

export { env }
