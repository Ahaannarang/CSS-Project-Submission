/**
 * "When can you take us?"
 *
 * The suggester answers "is this berth free on these dates". A coordinator on
 * the phone usually has the opposite question: the vessel and the length of the
 * stay are fixed, and the dates are what's negotiable. This walks forward from a
 * date and returns the earliest windows that actually work.
 *
 * It looks at the gaps between existing bookings rather than probing dates one
 * at a time, so the cost is proportional to the bookings on the fitting berths,
 * not to how far ahead it has to search.
 */
import { sql } from './db'

export type Opening = {
  berth_id: number
  name: string
  length_ft: number | null
  slack_ft: number | null
  start_date: string
  end_date: string          // inclusive, = start + nights - 1
  /** How many days the berth is free from start_date — may exceed the stay. */
  window_days: number | null
  starts_in_days: number
  reason: string
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const diff = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)

export async function findOpenings(opts: {
  vesselId?: number | null
  days: number                 // length of stay, inclusive days
  from: string
  limit?: number
}): Promise<{ openings: Opening[]; fit_checked: boolean; vessel: any; searched_to: string; reason: string | null }> {
  const { vesselId, from } = opts
  const days = Math.max(1, Math.min(opts.days, 365))
  const limit = Math.min(opts.limit ?? 8, 50)

  const [margin] = await sql<{ value: number }[]>`SELECT value FROM settings WHERE key = 'margin_ft'`
  const marginFt = Number(margin?.value ?? 0)

  let vessel: any = null
  if (vesselId) {
    const [v] = await sql<any[]>`SELECT id, name, length_ft FROM vessels WHERE id = ${vesselId}`
    vessel = v ?? null
  }
  const vLen = vessel?.length_ft != null ? Number(vessel.length_ft) : null

  // Only berths we can actually vouch for: a berth with no recorded length has
  // not been fit-checked, so it is not offered as an answer here.
  const berths = await sql<any[]>`
    SELECT id, name, length_ft FROM berths
    WHERE ${vLen}::numeric IS NULL
       OR (length_ft IS NOT NULL AND length_ft >= ${vLen}::numeric + ${marginFt})
    ORDER BY length_ft NULLS LAST, name`

  if (!berths.length) {
    return {
      openings: [], fit_checked: vLen != null, vessel, searched_to: from,
      reason: vLen != null
        ? `No berth with a recorded length is long enough for ${vessel?.name ?? 'this vessel'} (${vLen} ft).`
        : 'No berths are configured.',
    }
  }

  // Two years is far enough ahead that "no opening" means something is wrong.
  const horizon = addDays(from, 730)
  const booked = await sql<any[]>`
    SELECT berth_id, lower(during)::text AS start_date, upper(during)::text AS end_excl
    FROM reservations
    WHERE status = 'active' AND during && daterange(${from}::date, ${horizon}::date, '[)')
    ORDER BY berth_id, lower(during)`

  const byBerth = new Map<number, { start_date: string; end_excl: string }[]>()
  for (const r of booked) {
    const arr = byBerth.get(r.berth_id)
    arr ? arr.push(r) : byBerth.set(r.berth_id, [r])
  }

  const openings: Opening[] = []
  for (const b of berths) {
    const taken = byBerth.get(b.id) ?? []
    // Walk the gaps between bookings, starting at `from`.
    let cursor = from
    const gaps: { start: string; free: number | null }[] = []
    for (const r of taken) {
      if (r.start_date > cursor) gaps.push({ start: cursor, free: diff(cursor, r.start_date) })
      if (r.end_excl > cursor) cursor = r.end_excl
    }
    gaps.push({ start: cursor, free: null })     // open-ended tail

    const gap = gaps.find((g) => g.free == null || g.free >= days)
    if (!gap) continue

    const slack = b.length_ft == null || vLen == null ? null : Number(b.length_ft) - vLen
    openings.push({
      berth_id: b.id,
      name: b.name,
      length_ft: b.length_ft == null ? null : Number(b.length_ft),
      slack_ft: slack,
      start_date: gap.start,
      end_date: addDays(gap.start, days - 1),
      window_days: gap.free,
      starts_in_days: diff(from, gap.start),
      reason:
        gap.start === from
          ? slack == null ? 'Free right away' : `Free right away, ${slack} ft spare`
          : `First free ${diff(from, gap.start)} day${diff(from, gap.start) === 1 ? '' : 's'} later`,
    })
  }

  // Soonest first; among equally soon berths, the snuggest fit wins, exactly as
  // the berth suggester ranks, so the two screens never contradict each other.
  openings.sort(
    (a, b) =>
      a.start_date.localeCompare(b.start_date) ||
      (a.slack_ft ?? Infinity) - (b.slack_ft ?? Infinity) ||
      a.name.localeCompare(b.name),
  )

  return {
    openings: openings.slice(0, limit),
    fit_checked: vLen != null,
    vessel,
    searched_to: horizon,
    reason: openings.length ? null : `No berth has a free ${days}-day window in the next two years.`,
  }
}
