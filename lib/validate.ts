import { z } from 'zod'

/** Postgres int4. Anything larger overflows and surfaces as a 500. */
export const MAX_INT4 = 2_147_483_647

/**
 * A date that exists.
 *
 * The shape check alone lets through 2035-02-29 and 2035-00-10, which Postgres
 * then rejects at the driver level as a 500. Round-tripping through Date is the
 * cheapest way to ask "is this a real day". The year is bounded too, because
 * make_date() throws outside a sane range.
 */
function isRealDate(s: string): boolean {
  const [y, m, d] = s.split('-').map(Number)
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must look like YYYY-MM-DD')
  .refine(isRealDate, 'That date does not exist (check the month, day and year).')

const dbId = z.coerce.number().int().positive().max(MAX_INT4)

/**
 * Parses an identifier from a URL segment or query string.
 * Returns null for anything that is not a positive int4, so callers can answer
 * 400 instead of handing NaN to the database.
 */
export function parseId(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 && n <= MAX_INT4 ? n : null
}

/** A calendar date from a query string, or null if it is not one. */
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  return isRealDate(raw) ? raw : null
}

/** Dates are inclusive on the way in (A1) and converted to [start, end+1) below (A2). */
export const reservationInput = z
  .object({
    kind: z.enum(['vessel', 'event']),
    berth_id: dbId,
    vessel_id: dbId.nullish(),
    title: z.string().trim().min(1).max(200).nullish(),
    start_date: isoDate,
    end_date: isoDate,
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: 'The end date must be on or after the start date.',
    path: ['end_date'],
  })
  .refine((v) => (v.kind === 'vessel' ? v.vessel_id != null : true), {
    message: 'Pick a vessel.', path: ['vessel_id'],
  })
  .refine((v) => (v.kind === 'event' ? !!v.title : true), {
    message: 'Give the event a name.', path: ['title'],
  })
  // Silently dropping a vessel_id on an event would accept a request that means
  // something the caller did not get. Say no instead.
  .refine((v) => (v.kind === 'event' ? v.vessel_id == null : true), {
    message: 'An event occupies the whole berth and cannot name a vessel.', path: ['vessel_id'],
  })

export const reservationPatch = z.object({
  berth_id: dbId.optional(),
  vessel_id: dbId.nullish(),
  title: z.string().trim().max(200).nullish(),
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  status: z.enum(['active', 'cancelled']).optional(),
})

export const berthInput = z.object({
  name: z.string().trim().min(1).max(120),
  length_ft: z.coerce.number().positive().nullish(),
  notes: z.string().trim().max(500).nullish(),
})

export const vesselInput = z.object({
  name: z.string().trim().min(1).max(120),
  length_ft: z.coerce.number().positive().nullish(),
  type: z.string().trim().max(60).nullish(),
})

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Inclusive [start, end] -> half-open [start, end+1) */
export const toRange = (start: string, end: string) => `[${start},${addDays(end, 1)})`

export function zodMessage(e: z.ZodError): string {
  return e.issues[0]?.message ?? 'That request is not valid.'
}
