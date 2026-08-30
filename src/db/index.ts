import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema.js'
import { env } from '../lib/env.js'

/**
 * Connection strategy — see PROJECT-PLAN.md §9.
 *
 * The SumoPod DBaaS listener on :6432 is SESSION pooled (probed 10 Aug 2026), so
 * prepared statements are safe. `DATABASE_PREPARE` stays configurable so a switch
 * to transaction pooling is one env var, not a code change.
 *
 * `max: 1` because each serverless invocation is short-lived; a larger local pool
 * just consumes the cluster's shared connection budget.
 */
const options: postgres.Options<Record<string, never>> = {
  max: env.NODE_ENV === 'production' ? 1 : 5,
  idle_timeout: 20,

  /**
   * Recycle every connection well before the SumoPod pooler drops an idle one.
   * Without this, a long-running process keeps sockets the server has already
   * closed and every subsequent query queues on a dead connection forever.
   * A fresh connection to this cluster costs ~250ms, so recycling often is cheap.
   */
  max_lifetime: 60 * 5,
  connect_timeout: 15,

  /**
   * Server-side ceiling on any single statement. The cluster's own default is
   * 30s; 15s means a slow query surfaces as an error we can handle rather than
   * a request that hangs until the client gives up.
   *
   * Note this only binds statements the server actually received. A half-open
   * socket — one the pooler dropped while our side still believes it is open —
   * swallows the query before it arrives, so no server-side timeout can ever
   * fire. `resetPool` below is what recovers from that case.
   */
  connection: { statement_timeout: 15_000 },

  prepare: env.DATABASE_PREPARE,
  ssl: env.DATABASE_SSL === 'disable' ? false : (env.DATABASE_SSL as 'require' | 'prefer'),
  onnotice: () => {},
}

const connect = () => postgres(env.DATABASE_URL, options)

let client = connect()
let instance = drizzle(client, { schema })
let lastReset = 0

/**
 * Throw away the current pool and build a new one.
 *
 * A query sent down a half-open socket never returns and never times out, and
 * it holds its pool slot for the life of the process. A handful of those drains
 * the pool and every subsequent request queues behind them forever — the
 * failure that presented as "the API hangs but /health is fine", and that stalled
 * the landing page's static build until each route gave up at 60s.
 *
 * Every new query gets a live socket immediately, because the swap itself is
 * synchronous. The old client is then drained with a grace period rather than
 * destroyed outright: at `timeout: 0` it aborted queries that were running
 * perfectly well on healthy connections, which surfaced as a burst of
 * CONNECTION_DESTROYED 500s and failed the landing page's build. Five seconds
 * lets a live query finish while a dead one still gets cleaned up.
 *
 * Throttled, because the trigger (a request hitting its deadline) can arrive
 * several times at once and one rebuild clears them all.
 */
export function resetPool(reason: string): boolean {
  const now = Date.now()
  if (now - lastReset < 10_000) return false
  lastReset = now

  console.error('Rebuilding database pool', { reason })
  const stale = client
  client = connect()
  instance = drizzle(client, { schema })
  void stale.end({ timeout: 5 }).catch(() => {})
  return true
}

/**
 * `db` has to stay a stable import while the pool underneath it is replaceable,
 * so it forwards to whichever drizzle instance is current.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get: (_target, prop, receiver) => Reflect.get(instance, prop, receiver),
  has: (_target, prop) => prop in instance,
}) as ReturnType<typeof drizzle<typeof schema>>

/**
 * The raw postgres.js client, for the few places that need `sql` directly (the
 * seed and the admin reset both close it). A callable proxy target so tagging
 * it as a template literal keeps working if a caller ever needs that.
 */
export const sqlClient = new Proxy(function () {} as unknown as postgres.Sql, {
  get: (_target, prop, receiver) => Reflect.get(client, prop, receiver),
  apply: (_target, thisArg, args) =>
    Reflect.apply(client as unknown as (...a: unknown[]) => unknown, thisArg, args),
}) as postgres.Sql

export * from './schema.js'
