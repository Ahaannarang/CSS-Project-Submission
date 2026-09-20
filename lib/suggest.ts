/**
 * Berth auto-suggest: best fit first.
 *
 * Of the berths a vessel actually fits and that are free for the whole stay,
 * offer the SMALLEST. It is the classic best-fit heuristic: putting a 40 ft boat
 * on the 410 ft pier is legal but wasteful, because it is the only berth a 400 ft
 * research vessel could ever use. Ties break on name so the list is stable.
 *
 * Everything below is one indexed query; the GiST index on (berth_id, during)
 * that enforces the no-overlap rule is the same index that answers "is it free?".
 */
import { sql } from './db'

export type Suggestion = {
  berth_id: number
  name: string
  length_ft: number | null
  slack_ft: number | null
  label: string
  reason: string
}

export type Alternative = {
  berth_id: number
  name: string
  length_ft: number | null
  kind: 'shifted_dates' | 'frees_up'
  start_date?: string
  end_date?: string
  free_from?: string
  reason: string
}

export type SuggestResult = {
  /** Free, and the vessel provably fits. Ranked best-fit first. */
  suggestions: Suggestion[]
  /**
   * Free, but the berth has no length on record, so the fit rule cannot be
   * applied. Kept apart from `suggestions` on purpose: offering these as if
   * they were checked would be the app making exactly the promise it cannot
   * keep. The UI shows them below, marked as unverified.
   */
  unverified: Suggestion[]
  alternatives: Alternative[]
  /** Why the list is empty, in words a coordinator can repeat to a captain. */
  reason: string | null
  fit_checked: boolean
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function suggestBerths(opts: {
  vesselId?: number | null
  startDate: string
  endDate: string           // inclusive (A1)
  excludeReservationId?: number | null
}): Promise<SuggestResult> {
  const { startDate, endDate, vesselId, excludeReservationId } = opts
  const during = `[${startDate},${addDays(endDate, 1)})`

  const [margin] = await sql<{ value: number }[]>`SELECT value FROM settings WHERE key = 'margin_ft'`
  const marginFt = Number(margin?.value ?? 0)

  let vessel: { id: number; name: string; length_ft: number | null } | null = null
  if (vesselId) {
    const [v] = await sql<any[]>`SELECT id, name, length_ft FROM vessels WHERE id = ${vesselId}`
    vessel = v ?? null
  }
  const vLen = vessel?.length_ft != null ? Number(vessel.length_ft) : null
  const fitChecked = vLen != null

  // 1+2. Free for the whole stay, and — when we know the vessel's length — long
  //       enough for it. Events have no length, so they skip the fit test (A4).
  const rows = await sql<any[]>`
    SELECT b.id AS berth_id, b.name, b.length_ft,
           CASE WHEN b.length_ft IS NULL OR ${vLen}::numeric IS NULL
                THEN NULL ELSE b.length_ft - ${vLen}::numeric END AS slack_ft
    FROM berths b
    WHERE (${vLen}::numeric IS NULL OR b.length_ft IS NULL OR b.length_ft >= ${vLen}::numeric + ${marginFt})
      AND NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.berth_id = b.id AND r.status = 'active'
          AND r.during && ${during}::daterange
          AND (${excludeReservationId ?? null}::int IS NULL OR r.id <> ${excludeReservationId ?? null}::int))
    ORDER BY slack_ft NULLS LAST, b.name`

  // When the vessel's length is known, a berth with no length on record has not
  // been checked and must not be ranked as though it had been.
  const checkable = vLen != null
  const verifiedRows = checkable ? rows.filter((r) => r.length_ft != null) : rows
  const unverifiedRows = checkable ? rows.filter((r) => r.length_ft == null) : []

  const toSuggestion = (r: any, i: number): Suggestion => {
    const slack = r.slack_ft == null ? null : Number(r.slack_ft)
    return {
      berth_id: r.berth_id,
      name: r.name,
      length_ft: r.length_ft == null ? null : Number(r.length_ft),
      slack_ft: slack,
      label:
        r.length_ft == null && checkable ? 'Fit unknown'
          : i === 0 ? 'Best fit'
            : slack == null ? 'Available' : `${slack} ft spare`,
      reason:
        r.length_ft == null
          ? 'Free, but this berth has no length on record, so fit cannot be checked'
          : slack == null
            ? 'Free for these dates'
            : `Free, and ${slack} ft longer than the vessel`,
    }
  }

  const suggestions: Suggestion[] = verifiedRows.map(toSuggestion)
  const unverified: Suggestion[] = unverifiedRows.map((r) => toSuggestion(r, -1))

  if (suggestions.length) return { suggestions, unverified, alternatives: [], reason: null, fit_checked: fitChecked }

  // 5. Nothing verified is free. Say which of the two reasons it is — a vessel
  //    too long for the facility is a permanent no, a full week is not — then
  //    offer a way out.
  // "Fitting" means: a berth we could actually put this vessel on. When the
  //  vessel's length is unknown every berth qualifies; when it is known, only
  //  berths whose own length is recorded and large enough do.
  const [{ count: fittingBerths }] = await sql<{ count: number }[]>`
    SELECT count(*)::int FROM berths b
    WHERE ${vLen}::numeric IS NULL
       OR (b.length_ft IS NOT NULL AND b.length_ft >= ${vLen}::numeric + ${marginFt})`

  const unknownNote =
    unverified.length > 0
      ? ` ${unverified.length} berth${unverified.length === 1 ? ' has' : 's have'} no length on record and could not be checked.`
      : ''

  const reason =
    fittingBerths === 0
      ? vLen != null
        ? `No berth with a recorded length is long enough for ${vessel?.name ?? 'this vessel'} (${vLen} ft${marginFt ? ` plus ${marginFt} ft clearance` : ''}).${unknownNote}`
        : 'No berth exists.'
      : `All ${fittingBerths} berth${fittingBerths === 1 ? '' : 's'} that fit are booked for those dates.${unknownNote}`

  const alternatives = fittingBerths === 0 ? [] : await findAlternatives({ vLen, marginFt, startDate, endDate, excludeReservationId })
  return { suggestions: [], unverified, alternatives, reason, fit_checked: fitChecked }
}

/** FR11: nearest dates that work, and berths that free up partway through. */
async function findAlternatives(opts: {
  vLen: number | null
  marginFt: number
  startDate: string
  endDate: string
  excludeReservationId?: number | null
}): Promise<Alternative[]> {
  const { vLen, marginFt, startDate, endDate, excludeReservationId } = opts
  const nights = Math.round(
    (Date.parse(endDate + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z')) / 86400000,
  )
  const out: Alternative[] = []

  // Shift the whole stay up to 14 days either way; nearest offset wins.
  const offsets = [...Array(15).keys()].flatMap((i) => (i === 0 ? [0] : [i, -i]))
  for (const off of offsets) {
    if (off === 0) continue
    const s = addDays(startDate, off)
    const e = addDays(endDate, off)
    const rows = await sql<any[]>`
      SELECT b.id AS berth_id, b.name, b.length_ft
      FROM berths b
      WHERE (${vLen}::numeric IS NULL OR (b.length_ft IS NOT NULL AND b.length_ft >= ${vLen}::numeric + ${marginFt}))
        AND NOT EXISTS (
          SELECT 1 FROM reservations r
          WHERE r.berth_id = b.id AND r.status = 'active'
            AND r.during && ${`[${s},${addDays(e, 1)})`}::daterange
            AND (${excludeReservationId ?? null}::int IS NULL OR r.id <> ${excludeReservationId ?? null}::int))
      ORDER BY b.length_ft, b.name LIMIT 2`
    for (const r of rows) {
      out.push({
        berth_id: r.berth_id, name: r.name,
        length_ft: r.length_ft == null ? null : Number(r.length_ft),
        kind: 'shifted_dates', start_date: s, end_date: e,
        reason: `${r.name} is free ${off > 0 ? `${off} day${off === 1 ? '' : 's'} later` : `${-off} day${off === -1 ? '' : 's'} earlier`}`,
      })
    }
    if (out.length >= 3) break
  }

  // Berths that clear before the stay would end.
  const freeing = await sql<any[]>`
    SELECT b.id AS berth_id, b.name, b.length_ft, max(upper(r.during))::text AS free_from
    FROM berths b
    JOIN reservations r ON r.berth_id = b.id AND r.status = 'active'
                       AND r.during && ${`[${startDate},${addDays(endDate, 1)})`}::daterange
    WHERE (${vLen}::numeric IS NULL OR (b.length_ft IS NOT NULL AND b.length_ft >= ${vLen}::numeric + ${marginFt}))
    GROUP BY b.id, b.name, b.length_ft
    HAVING max(upper(r.during)) <= ${addDays(endDate, 1)}::date
    ORDER BY max(upper(r.during)) LIMIT 3`
  for (const r of freeing) {
    out.push({
      berth_id: r.berth_id, name: r.name,
      length_ft: r.length_ft == null ? null : Number(r.length_ft),
      kind: 'frees_up', free_from: r.free_from,
      reason: `${r.name} is free from ${new Date(r.free_from + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`,
    })
  }

  return out.slice(0, 6)
}
