/**
 * Translating database rejections into answers a coordinator can act on.
 *
 * The rules live in Postgres, so the API's job is not to re-check them but to
 * explain them. A 409 names the booking that is in the way; a 422 names the
 * lengths that do not work.
 */
import { sql } from './db'

export type ApiError = { status: number; body: Record<string, unknown> }

export class HttpError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body.error ?? 'error'))
  }
}

export const bad = (message: string, extra: Record<string, unknown> = {}) =>
  new HttpError(400, { error: 'invalid_request', message, ...extra })

/**
 * Turns a Postgres error into an HTTP response.
 * 23P01 = exclusion constraint  -> the berth is already taken.
 * 23514 + our fit hint          -> the vessel is too long for the berth.
 */
export async function mapPgError(
  e: any,
  ctx: { berthId?: number; during?: string },
): Promise<HttpError> {
  if (e?.code === '23P01') {
    let conflicts: any[] = []
    if (ctx.berthId && ctx.during) {
      conflicts = await sql`
        SELECT r.id, r.kind, r.title, v.name AS vessel,
               lower(r.during)::text AS start_date, (upper(r.during) - 1)::text AS end_date
        FROM reservations r LEFT JOIN vessels v ON v.id = r.vessel_id
        WHERE r.berth_id = ${ctx.berthId} AND r.status = 'active'
          AND r.during && ${ctx.during}::daterange
        ORDER BY lower(r.during)`
    }
    const c = conflicts[0]
    const who = c ? (c.vessel ?? c.title ?? 'another booking') : 'another booking'
    const when = c ? ` ${fmt(c.start_date)}–${fmt(c.end_date)}` : ''
    return new HttpError(409, {
      error: 'berth_unavailable',
      message: `That berth is already booked by ${who}${when}.`,
      conflicts,
    })
  }

  if (e?.code === '23514' && /"?fit"?/.test(e.detail ?? '')) {
    let detail: any = {}
    try { detail = JSON.parse(e.detail) } catch { /* keep the message alone */ }
    return new HttpError(422, {
      error: 'vessel_does_not_fit',
      message: e.message,
      ...detail,
    })
  }

  if (e?.code === '23514' && /during_not_empty|during_bounded/.test(e.constraint_name ?? '')) {
    return new HttpError(400, { error: 'invalid_dates', message: 'The end date must be on or after the start date.' })
  }

  if (e?.code === '23514' && /kind_shape/.test(e.constraint_name ?? '')) {
    return new HttpError(400, {
      error: 'invalid_request',
      message: 'A vessel booking needs a vessel; an event needs a title.',
    })
  }

  if (e?.code === '23503') {
    return new HttpError(400, { error: 'unknown_reference', message: 'That berth or vessel does not exist.' })
  }

  throw e
}

const fmt = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
