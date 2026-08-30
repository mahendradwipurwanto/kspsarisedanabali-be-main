// Must be first: populates process.env before ./lib/env.ts validates it.
// Vercel injects environment variables directly, so `api/index.ts` needs no equivalent.
import 'dotenv/config'

import { createApp } from './app.js'
import { env } from './lib/env.js'

/**
 * Local development entrypoint only. Vercel never imports this file — it uses
 * `api/index.ts`, which exports the app without ever calling `listen`.
 */
const app = createApp()

app.listen(env.PORT, () => {
  console.log(`→ KSP API listening on http://localhost:${env.PORT}`)
  console.log(`  health: http://localhost:${env.PORT}/v1/public/health`)
})
