/**
 * Legacy import.
 *
 * Reads the 23-year workbook, loads everything it can as real reservations, and
 * records every problem it meets instead of guessing or dropping rows (A8).
 *
 * The database is the arbiter, not this script: each stay is offered to Postgres
 * as an ACTIVE reservation, and whatever the exclusion constraint or the fit
 * trigger rejects is re-inserted as FLAGGED with an issue attached. So the audit
 * report is a record of what the rules actually caught, not of what a parser
 * guessed they might catch.
 */
import 'dotenv/config'
import postgres from 'postgres'
import { loadWorkbook, parseAllYears, parseVesselRegistry } from '../lib/parse/workbook'
import { buildReservations } from '../lib/parse/build'
import { classifyCell } from '../lib/parse/classify'
import { parseVesselName } from '../lib/parse/normalize'

const SOURCE = process.argv[2] ?? 'data/Dock Schedule - Synthetic Sample.xlsx'
const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1) }
const sql = postgres(url, { ssl: url.includes('localhost') ? false : 'require', max: 1 })

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const t0 = Date.now()
  console.log(`reading ${SOURCE}`)
  const wbh = loadWorkbook(SOURCE)
  const { years, per } = parseAllYears(wbh)

  const allCells = years.flatMap((y) => per[y].cells)
  const allBerthless = years.flatMap((y) => per[y].berthless)
  const allUndated = years.flatMap((y) => per[y].undated)
  const allOrphans = years.flatMap((y) => per[y].orphans)
  const allWeekday = years.flatMap((y) => per[y].weekdayMismatches.map((m) => ({ ...m, year: Number(y) })))
  const allYearMismatch = years.flatMap((y) => per[y].yearMismatches.map((m) => ({ ...m, year: Number(y) })))

  const cellsRead = allCells.length + allBerthless.length + allUndated.length + allOrphans.length
  console.log(`  ${years.length} year sheets, ${cellsRead} non-empty schedule cells`)

  // ---------------------------------------------------------------- berths
  const berthMap = new Map<string, { name: string; length: number | null; n: number }>()
  for (const c of allCells) {
    const e = berthMap.get(c.berthName) ?? { name: c.berthName, length: null, n: 0 }
    e.n++
    if (c.berthLengthFt != null) e.length = Math.max(e.length ?? 0, c.berthLengthFt)
    berthMap.set(c.berthName, e)
  }
  const berthIds = new Map<string, number>()
  let order = 0
  for (const b of [...berthMap.values()].sort((a, b) => (b.length ?? 0) - (a.length ?? 0))) {
    const [row] = await sql`
      INSERT INTO berths (name, length_ft, sort_order)
      VALUES (${b.name}, ${b.length}, ${order++})
      ON CONFLICT (name) DO UPDATE SET length_ft = COALESCE(EXCLUDED.length_ft, berths.length_ft)
      RETURNING id`
    berthIds.set(b.name, row.id)
  }
  console.log(`  berths: ${berthIds.size} (${[...berthMap.values()].filter((b) => b.length == null).length} without a stated length)`)

  // ---------------------------------------------------------------- vessels
  const registry = parseVesselRegistry(wbh)
  const regByKey = new Map(registry.map((v) => [v.name.key, v]))

  const vesselAliases = new Map<string, Set<string>>()
  const vesselDisplay = new Map<string, string>()
  for (const c of allCells) {
    const m = classifyCell(c.text)
    if (m?.kind !== 'vessel') continue
    const k = m.vessel.key
    if (!vesselAliases.has(k)) vesselAliases.set(k, new Set())
    vesselAliases.get(k)!.add(c.text)
    if (!vesselDisplay.has(k)) vesselDisplay.set(k, m.vessel.display)
  }
  for (const v of registry) {
    if (!vesselAliases.has(v.name.key)) vesselAliases.set(v.name.key, new Set())
    vesselDisplay.set(v.name.key, v.name.display)
  }

  const vesselIds = new Map<string, number>()
  const unknownLength: string[] = []
  for (const [key, aliases] of vesselAliases) {
    const reg = regByKey.get(key)
    const length = reg?.lengthFt ?? null
    const type = reg ? (reg.tab === 'Science' ? 'research' : 'visiting') : null
    if (length == null) unknownLength.push(vesselDisplay.get(key)!)
    const [row] = await sql`
      INSERT INTO vessels (name, length_ft, type, aliases)
      VALUES (${vesselDisplay.get(key)!}, ${length}, ${type}, ${[...aliases]})
      ON CONFLICT (name) DO UPDATE SET
        length_ft = COALESCE(EXCLUDED.length_ft, vessels.length_ft),
        aliases   = EXCLUDED.aliases
      RETURNING id`
    vesselIds.set(key, row.id)
  }
  console.log(`  vessels: ${vesselIds.size} (${registry.length} in the reference tabs, ${unknownLength.length} with no length on record)`)

  // ---------------------------------------------------------------- stays
  const { reservations, annotations, duplicateCells } = buildReservations(allCells)
  console.log(`  stays: ${reservations.length} built from ${allCells.length} day cells (${duplicateCells.length} duplicate cells collapsed)`)

  const stats = {
    cells_read: cellsRead,
    stays_built: reservations.length,
    imported_active: 0,
    flagged_overlap: 0,
    flagged_misfit: 0,
    annotations: annotations.length,
    unknown_berth: allBerthless.length,
    undated: allUndated.length,
    parse_errors: allOrphans.length,
    unknown_vessel: unknownLength.length,
    vessel_conflicts: 0,
    vessels_with_length: 0,
    stays_fit_checkable: 0,
    duplicate_cells: duplicateCells.length,
    weekday_mismatches: allWeekday.length,
    year_mismatches: allYearMismatch.length,
  }

  // How much of the history can actually be fit-checked? The reference tabs cover
  // only a fraction of the vessels that appear in the schedule, and that gap is
  // the single biggest limit on what the audit can prove.
  stats.vessels_with_length = [...vesselAliases.keys()].filter((k) => regByKey.get(k)?.lengthFt != null).length
  stats.stays_fit_checkable = reservations.filter(
    (r) => r.kind === 'vessel' && regByKey.get(r.entityKey.slice(2))?.lengthFt != null,
  ).length

  const [run] = await sql`INSERT INTO import_runs (source, stats) VALUES (${SOURCE}, ${sql.json({})}) RETURNING id`

  // Chronological, so "the first booking wins the berth" like the old grid did.
  let done = 0
  for (const r of reservations) {
    const berthId = berthIds.get(r.berthName)!
    const vesselId = r.kind === 'vessel' ? vesselIds.get(r.entityKey.slice(2))! : null
    const during = `[${r.startDate},${addDays(r.endDate, 1)})`   // A1 -> A2
    const vesselFt = r.kind === 'vessel' ? regByKey.get(r.entityKey.slice(2))?.lengthFt ?? null : null
    const detail = {
      berth: r.berthName, start: r.startDate, end: r.endDate, days: r.days,
      vessel: r.vesselDisplay, title: r.title, refs: r.refs.slice(0, 8),
      // The audit renders the shortfall from these, so they have to be
      // structured fields, not only prose inside the error message.
      vessel_ft: vesselFt,
      berth_ft: r.berthLengthFt,
    }

    const insert = (status: 'active' | 'flagged') => sql`
      INSERT INTO reservations (berth_id, vessel_id, kind, title, during, status, source, source_key)
      VALUES (${berthId}, ${vesselId}, ${r.kind}, ${r.title}, ${during}::daterange, ${status}, 'legacy_import', ${r.sourceKey})
      ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
      RETURNING id`

    try {
      const [row] = await insert('active')
      if (row) stats.imported_active++
    } catch (e: any) {
      const code = e.code as string | undefined
      const isOverlap = code === '23P01'
      const isMisfit = code === '23514' && /fit/.test(e.detail ?? e.message ?? '')
      if (!isOverlap && !isMisfit) throw e

      // Find what it collided with, so the audit can name both parties.
      let conflicts: any[] = []
      if (isOverlap) {
        conflicts = await sql`
          SELECT r.id, r.kind, r.title, v.name AS vessel,
                 lower(r.during)::text AS start_date, (upper(r.during) - 1)::text AS end_date
          FROM reservations r LEFT JOIN vessels v ON v.id = r.vessel_id
          WHERE r.berth_id = ${berthId} AND r.status = 'active' AND r.during && ${during}::daterange`
      }

      const [row] = await insert('flagged')
      if (row) {
        await sql`
          INSERT INTO import_issues (reservation_id, kind, year, berth_id, detail, issue_key)
          VALUES (${row.id}, ${isOverlap ? 'overlap' : 'misfit'}, ${Number(r.startDate.slice(0, 4))}, ${berthId},
                  ${sql.json({ ...detail, conflicts, reason: isOverlap ? 'overlaps an existing booking' : e.message })},
                  ${(isOverlap ? 'overlap|' : 'misfit|') + r.sourceKey})
          ON CONFLICT (issue_key) WHERE issue_key IS NOT NULL DO NOTHING`
        if (isOverlap) stats.flagged_overlap++; else stats.flagged_misfit++
      }
    }
    if (++done % 250 === 0) process.stdout.write(`\r  inserting stays ... ${done}/${reservations.length}`)
  }
  process.stdout.write(`\r  inserting stays ... ${reservations.length}/${reservations.length}\n`)

  // ------------------------------------------------- issues that are not stays
  const issueRows: any[] = []
  const push = (kind: string, year: number | null, berthId: number | null, detail: any) =>
    issueRows.push({
      kind, year, berth_id: berthId, detail,
      // Stable identity: same file, same issue, same row on every re-run.
      issue_key: `${kind}|${detail.ref ?? ''}|${detail.date ?? ''}|${detail.vessel ?? ''}|${detail.text ?? ''}`.slice(0, 400),
    })

  for (const b of allBerthless)
    push('unknown_berth', b.year, null, { date: b.date, text: b.text, ref: b.ref, reason: 'entry sits below the berth rows, so its berth is unrecorded' })
  for (const u of allUndated)
    push('parse_error', u.year, u.berthName ? berthIds.get(u.berthName) ?? null : null, { text: u.text, ref: u.ref, berth: u.berthName, reason: 'column falls outside the month, so the date is unknown' })
  for (const o of allOrphans)
    push('parse_error', null, null, { text: o.text, ref: o.ref, reason: o.reason })
  for (const a of annotations)
    push('annotation', Number(a.date.slice(0, 4)), berthIds.get(a.berthName) ?? null, { date: a.date, berth: a.berthName, text: a.text, ref: a.ref, reason: `${a.reason} - recorded, but does not occupy the berth` })
  for (const name of unknownLength)
    push('unknown_vessel', null, null, { vessel: name, reason: 'no length on the Science or Yachts tabs, so fit cannot be checked' })
  for (const v of registry.filter((v) => v.conflict))
    push('unknown_vessel', null, null, { vessel: v.name.display, reason: `length disagrees between name (${v.lengthFromName} ft) and LOA (${v.lengthFromLoa} ft); kept the larger`, ref: v.ref })
  for (const m of allWeekday.slice(0, 200))
    push('parse_error', m.year, null, { ref: m.ref, reason: `weekday header says ${m.found} where the calendar says ${m.expected}` })
  for (const m of allYearMismatch)
    push('parse_error', m.year, null, { ref: m.ref, reason: `header year ${m.headerYear} does not match sheet ${m.sheetYear}; read as ${m.sheetYear}` })

  // Same vessel, two berths, one day: physically impossible, invisible in a grid.
  const vesselDay = new Map<string, Set<string>>()
  for (const c of allCells) {
    const m = classifyCell(c.text)
    if (m?.kind !== 'vessel') continue
    const k = `${m.vessel.key}|${c.date}`
    if (!vesselDay.has(k)) vesselDay.set(k, new Set())
    vesselDay.get(k)!.add(c.berthName)
  }
  for (const [k, berths] of vesselDay) {
    if (berths.size < 2) continue
    const [vkey, date] = k.split('|')
    stats.vessel_conflicts++
    push('vessel_conflict', Number(date.slice(0, 4)), null, {
      vessel: vesselDisplay.get(vkey), date, berths: [...berths],
      reason: 'the same vessel is recorded at more than one berth on this day',
    })
  }

  for (let i = 0; i < issueRows.length; i += 500) {
    const chunk = issueRows.slice(i, i + 500)
    await sql`
      INSERT INTO import_issues ${sql(
        chunk.map((r) => ({ kind: r.kind, year: r.year, berth_id: r.berth_id, detail: sql.json(r.detail), issue_key: r.issue_key })),
        'kind', 'year', 'berth_id', 'detail', 'issue_key',
      )}
      ON CONFLICT (issue_key) WHERE issue_key IS NOT NULL DO NOTHING`
  }

  await sql`UPDATE import_runs SET stats = ${sql.json(stats)} WHERE id = ${run.id}`

  console.log(`\n=== import summary (${((Date.now() - t0) / 1000).toFixed(1)}s) ===`)
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(20)} ${v}`)
  const [{ count: total }] = await sql`SELECT count(*)::int FROM reservations`
  const [{ count: issues }] = await sql`SELECT count(*)::int FROM import_issues`
  console.log(`  reservations in db    ${total}`)
  console.log(`  import issues in db   ${issues}`)
  await sql.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
