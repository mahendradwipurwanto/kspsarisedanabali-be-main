import { createApp } from '../src/app.js'

/**
 * Vercel serverless entrypoint.
 *
 * An Express app is itself a `(req, res)` handler, so exporting it is all Vercel
 * needs. `vercel.json` rewrites every path here. Note there is no `listen()` —
 * that lives in `src/server.ts` for local development only.
 *
 * The app is built once per warm instance and reused across invocations.
 */
export default createApp()
