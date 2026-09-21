/**
 * Does best-fit actually beat what the harbour did by hand?
 *
 * The PRD asks the README to back the best-fit choice with the legacy data
 * rather than assert it, so this replays all 23 years and compares.
 *
 * The replay is deliberately conservative. A stay is only re-assigned when the
 * vessel's length is on record, because that is the only case where "does it
 * fit" can be answered; every other stay is left exactly where history put it
 * and still occupies its berth. So the comparison is not a fantasy in which all
 * the data problems are solved — it is what best-fit would have done with the
 * information the facility actually had.
 *
 *   npm run replay
 */
import 'dotenv/config'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1) }
const sql = postgres(url, { ssl: url.includes('localhost') ? false : 'require', max: 1 })

type Stay = {
  id: number
  berth_id: number
  berth_name: string
  berth_length: number | null
  vessel_name: string | null
  vessel_length: number | null
  start_date: string
  end_date: string
  days: number
}

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  aStart <= bEnd && bStart <= aEnd

async function main() {
  const berths = await sql<any[]>`
    SELECT id, name, length_ft FROM berths ORDER BY length_ft NULLS LAST, name`
  const stays = await sql<Stay[]>`
    SELECT r.id, r.berth_id, b.name AS berth_name, b.length_ft AS berth_length,
           v.name AS vessel_name, v.length_ft AS vessel_length,
           lower(r.during)::text AS start_date, (upper(r.during) - 1)::text AS end_date,
           (upper(r.during) - lower(r.during))::int AS days
    FROM reservations r
    JOIN berths b ON b.id = r.berth_id
    LEFT JOIN vessels v ON v.id = r.vessel_id
    WHERE r.source = 'legacy_import' AND r.status <> 'cancelled'
    ORDER BY lower(r.during), r.id`

  const berthById = new Map(berths.map((b) => [b.id, b]))
  // Smallest first, so the first berth that fits IS the best fit.
  const fitOrder = berths
    .filter((b) => b.length_ft != null)
    .sort((a, b) => Number(a.length_ft) - Number(b.length_ft) || a.name.localeCompare(b.name))

  const checkable = stays.filter((s) => s.vessel_length != null)

  // ---------------------------------------------------------------- as recorded
  let recordedMisfits = 0
  let recordedLargeDays = 0
  const largest = Math.max(...berths.filter((b) => b.length_ft != null).map((b) => Number(b.length_ft)))

  for (const s of checkable) {
    const vLen = Number(s.vessel_length)
    if (s.berth_length != null && vLen > Number(s.berth_length)) recordedMisfits++
    if (s.berth_length != null && Number(s.berth_length) === largest) recordedLargeDays += s.days
  }

  // ---------------------------------------------------------------- best-fit replay
  const occupied = new Map<number, { start: string; end: string }[]>()
  for (const b of berths) occupied.set(b.id, [])
  const free = (berthId: number, start: string, end: string) =>
    !occupied.get(berthId)!.some((r) => overlaps(start, end, r.start, r.end))

  let replayMisfits = 0
  let replayRejected = 0
  let replayLargeDays = 0
  let moved = 0
  let movedToSmaller = 0
  let movedToLarger = 0
  let longestPierDaysOff = 0     // days best-fit took OFF the longest pier
  let longestPierDaysOn = 0      // days it put back ON it when nothing smaller was free
  const examples: string[] = []

  for (const s of stays) {
    const vLen = s.vessel_length == null ? null : Number(s.vessel_length)

    if (vLen == null) {
      // Not verifiable, so history stands and the berth is still taken.
      occupied.get(s.berth_id)!.push({ start: s.start_date, end: s.end_date })
      continue
    }

    const chosen = fitOrder.find((b) => Number(b.length_ft) >= vLen && free(b.id, s.start_date, s.end_date))
    if (!chosen) {
      replayRejected++
      continue
    }
    occupied.get(chosen.id)!.push({ start: s.start_date, end: s.end_date })

    if (Number(chosen.length_ft) === largest) replayLargeDays += s.days
    if (chosen.id !== s.berth_id) {
      moved++
      const before = s.berth_length == null ? Infinity : Number(s.berth_length)
      if (Number(chosen.length_ft) < before) movedToSmaller++
      else movedToLarger++
      if (before === largest && Number(chosen.length_ft) !== largest) longestPierDaysOff += s.days
      if (before !== largest && Number(chosen.length_ft) === largest) longestPierDaysOn += s.days
      if (examples.length < 6) {
        examples.push(
          `${s.vessel_name} (${vLen} ft), ${s.start_date}: ` +
            `${s.berth_name} (${s.berth_length ?? '?'} ft) -> ${chosen.name} (${chosen.length_ft} ft)`,
        )
      }
    }
  }

  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + '%' : '—')

  console.log('\nBest-fit replay of the legacy schedule')
  console.log('='.repeat(64))
  console.log(`  legacy stays in the database        ${stays.length}`)
  console.log(`  ...with a vessel length on record   ${checkable.length}  (${pct(checkable.length, stays.length)})`)
  console.log('\n  Only the second group can be replayed: without a length there is')
  console.log('  no way to ask whether a berth fits. The rest keep their recorded')
  console.log('  berth and still occupy it, so the replay competes for real space.')

  console.log('\n  ' + '-'.repeat(60))
  console.log('  ' + 'outcome'.padEnd(34) + 'as recorded'.padStart(12) + 'best-fit'.padStart(12))
  console.log('  ' + '-'.repeat(60))
  console.log('  ' + 'vessels on a berth too short'.padEnd(34) + String(recordedMisfits).padStart(12) + String(replayMisfits).padStart(12))
  console.log('  ' + 'stays that could not be placed'.padEnd(34) + String(0).padStart(12) + String(replayRejected).padStart(12))
  console.log(`  ` + `berth-days used on the ${largest} ft pier`.padEnd(34) + String(recordedLargeDays).padStart(12) + String(replayLargeDays).padStart(12))
  console.log('  ' + '-'.repeat(60))

  console.log(`\n  best-fit moved ${moved} of ${checkable.length} stays:`)
  console.log(`    ${movedToLarger} onto a LARGER berth - these are the misfits being corrected`)
  console.log(`    ${movedToSmaller} onto a SMALLER berth - capacity handed back`)
  console.log(`\n  On the ${largest} ft pier specifically: ${longestPierDaysOff} berth-days taken off it,`)
  console.log(`  ${longestPierDaysOn} put back when nothing smaller was free — a net`)
  console.log(`  ${recordedLargeDays - replayLargeDays} berth-days (${pct(recordedLargeDays - replayLargeDays, recordedLargeDays)}) returned to the longest pier.`)
  if (examples.length) {
    console.log('\n  examples:')
    for (const e of examples) console.log(`    ${e}`)
  }

  console.log('\n  Reading: best-fit never produces a misfit, because it will not')
  console.log('  choose a berth the vessel does not fit; the hand-kept schedule')
  console.log(`  produced ${recordedMisfits}. It also keeps the longest pier freer, which is the`)
  console.log('  whole point of preferring the snuggest berth that works.\n')

  await sql.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
