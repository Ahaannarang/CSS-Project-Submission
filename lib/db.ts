import postgres from 'postgres'

type Sql = ReturnType<typeof postgres>

declare global {
  // eslint-disable-next-line no-var
  var __berthSql: Sql | undefined
}

let cached: Sql | undefined

function connect(): Sql {
  if (cached) return cached
  if (global.__berthSql) return (cached = global.__berthSql)

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Locally: copy .env.example to .env. ' +
        'On Vercel: add it under Settings → Environment Variables, then redeploy.',
    )
  }

  const isLocal = url.includes('localhost') || url.includes('127.0.0.1')

  /**
   * Neon's pooled endpoint runs pgbouncer in transaction mode, which cannot hold
   * a prepared statement across statements. postgres.js prepares by default, so
   * a pooled URL needs that turned off — otherwise the app works locally and
   * fails on its first query in production, which is a miserable thing to debug.
   */
  const isPooled = url.includes('-pooler') || url.includes('pgbouncer=true')

  /** Serverless runs many small instances, so each keeps only a few connections. */
  const serverless = !!process.env.VERCEL

  cached = postgres(url, {
    max: serverless ? 3 : 10,
    idle_timeout: serverless ? 20 : undefined,
    connect_timeout: 10,
    prepare: !isPooled,
    ssl: isLocal ? false : 'require',
  })

  // Reuse one pool across hot reloads in development.
  if (process.env.NODE_ENV !== 'production') global.__berthSql = cached
  return cached
}

/**
 * The database handle, connected on first use rather than on import.
 *
 * `next build` loads every route module to collect metadata. Connecting at
 * import time would make the build itself require a reachable database, so a
 * first deploy would fail before the environment variable had ever been read.
 */
export const sql: Sql = new Proxy((() => {}) as unknown as Sql, {
  apply: (_target, _thisArg, args: any[]) => (connect() as any)(...args),
  get: (_target, prop) => {
    const value = (connect() as any)[prop]
    return typeof value === 'function' ? value.bind(connect()) : value
  },
})

/** Postgres error codes we translate into user-facing API responses. */
export const PG_EXCLUSION_VIOLATION = '23P01'
export const PG_CHECK_VIOLATION = '23514'

export type PgError = Error & { code?: string; message: string; detail?: string; hint?: string; constraint_name?: string }
