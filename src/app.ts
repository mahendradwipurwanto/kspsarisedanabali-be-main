import express, { type Express, type RequestHandler } from 'express'
import cors from 'cors'
import * as helmetModule from 'helmet'
import cookieParser from 'cookie-parser'
import { env, corsOrigins } from './lib/env.js'

/**
 * helmet's package.json `exports` map declares only `import` and `require` —
 * there is no `types` condition — so which declaration file TypeScript picks
 * depends entirely on how the consuming file is being compiled. Vercel's build
 * resolves the CommonJS one, where neither `import helmet from 'helmet'` nor
 * reading `.default` off a namespace import typechecks as callable:
 *
 *   src/app.ts(59,5): error TS2349: This expression is not callable.
 *   Type 'typeof import(".../helmet/index")' has no call signatures.
 *
 * Both declarations do export the function — only the *type* differs by
 * resolution — and neither could be reproduced locally. So rather than keep
 * guessing which file the compiler chose, the call signature is declared here
 * and applied through `unknown`. The runtime lookup covers both module shapes:
 * index.mjs exports `default`, and index.cjs sets `exports.default`.
 *
 * The options type is narrowed to what this app actually passes, so a typo in
 * these two settings is still caught.
 */
type HelmetFactory = (options?: {
  contentSecurityPolicy?: boolean
  crossOriginResourcePolicy?: boolean | { policy: 'same-origin' | 'same-site' | 'cross-origin' }
}) => RequestHandler

const helmet: HelmetFactory =
  (helmetModule as unknown as { default?: HelmetFactory }).default ??
  (helmetModule as unknown as HelmetFactory)
import { attachIp, errorHandler, notFoundHandler, responseDeadline } from './middleware/index.js'
import { authRouter } from './modules/auth.js'
import { publicRouter } from './modules/public.js'
import { publicLeadRouter, leadRouter } from './modules/leads.js'
import { publicFeedbackRouter, feedbackRouter } from './modules/feedback.js'
import { pageRouter } from './modules/pages.js'
import { mediaRouter } from './modules/media.js'
import { userRouter, roleRouter, auditRouter } from './modules/users.js'
import { trackRouter, analyticsRouter } from './modules/analytics.js'
import { retentionRouter } from './modules/retention.js'
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
  // The raw bytes are kept for request signatures: the console signs the body
  // it sent, and the server must hash exactly those bytes, not a re-serialised
  // object. The media upload is read raw before authentication for the same reason.
  const keepRaw = (req: express.Request, _res: express.Response, buf: Buffer) => { req.rawBody = buf }
  app.use('/v1/media/upload', express.raw({ type: () => true, limit: '25mb' }))
  app.use(express.json({ limit: '1mb', verify: keepRaw }))
  app.use(express.urlencoded({ extended: true, limit: '1mb', verify: keepRaw }))
  app.use(cookieParser())
  app.use(attachIp)
  app.use(responseDeadline())

  app.get('/', (_req, res) => {
    res.json({ service: 'KSP Sari Sedana Bali API', version: '1.0.0', docs: '/v1/public/health' })
  })

  app.use('/v1/auth', authRouter)
  app.use('/v1/public', publicRouter)
  app.use('/v1/public', publicLeadRouter)
  app.use('/v1/public', publicFeedbackRouter)
  app.use('/v1/track', trackRouter)
  app.use('/v1/cron', retentionRouter)

  app.use('/v1/pages', pageRouter)
  app.use('/v1/media', mediaRouter)
  app.use('/v1/leads', leadRouter)
  app.use('/v1/feedback', feedbackRouter)
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
