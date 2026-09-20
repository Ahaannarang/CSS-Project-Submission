/**
 * Turns parsed grid cells into proposed reservations.
 *
 * The grid records occupancy one day at a time, so a five-day visit appears as
 * five cells. Consecutive days for the same vessel on the same berth collapse
 * into a single stay; a gap starts a new one. Dates are kept inclusive here and
 * converted to the half-open range [start, end+1) at insert time (A1/A2).
 */

import { classifyCell } from './classify'
import type { GridCell } from './grid'

export type ProposedReservation = {
  kind: 'vessel' | 'event'
  berthName: string
  berthLengthFt: number | null
  /** normalised vessel key, or the event title */
  entityKey: string
  vesselDisplay: string | null
  title: string | null
  startDate: string
  endDate: string          // inclusive
  days: number
  refs: string[]
  sourceKey: string
}

export type AnnotationRecord = { date: string; berthName: string; text: string; reason: string; ref: string }

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function buildReservations(cells: GridCell[]): {
  reservations: ProposedReservation[]
  annotations: AnnotationRecord[]
  duplicateCells: { date: string; berthName: string; kept: string; dropped: string; ref: string }[]
} {
  const annotations: AnnotationRecord[] = []
  const duplicateCells: { date: string; berthName: string; kept: string; dropped: string; ref: string }[] = []

  // One occupant per berth-day. The 2002-2004 sheets repeat the previous
  // December, so identical repeats collapse; a genuine disagreement is kept and
  // surfaces later as a conflict rather than being silently picked.
  type Occ = { key: string; kind: 'vessel' | 'event'; display: string; title: string | null; cell: GridCell }
  const byBerthDay = new Map<string, Occ>()
  const extras: Occ[] = []

  for (const c of cells) {
    const meaning = classifyCell(c.text)
    if (!meaning) continue
    if (meaning.kind === 'annotation') {
      annotations.push({ date: c.date, berthName: c.berthName, text: c.text, reason: meaning.reason, ref: c.ref })
      continue
    }
    const occ: Occ =
      meaning.kind === 'vessel'
        ? { key: 'v:' + meaning.vessel.key, kind: 'vessel', display: meaning.vessel.display, title: null, cell: c }
        : { key: 'e:' + meaning.title.toLowerCase(), kind: 'event', display: meaning.title, title: meaning.title, cell: c }

    const slot = `${c.berthName}|${c.date}`
    const existing = byBerthDay.get(slot)
    if (!existing) { byBerthDay.set(slot, occ); continue }
    if (existing.key === occ.key) {
      duplicateCells.push({ date: c.date, berthName: c.berthName, kept: existing.cell.ref, dropped: c.ref, ref: c.ref })
    } else {
      extras.push(occ)   // two different occupants claim one berth-day
    }
  }

  // Collapse consecutive days per (berth, occupant) into stays.
  const runs = (list: Occ[]): ProposedReservation[] => {
    const grouped = new Map<string, Occ[]>()
    for (const o of list) {
      const k = `${o.cell.berthName}|${o.key}`
      const arr = grouped.get(k); arr ? arr.push(o) : grouped.set(k, [o])
    }
    const out: ProposedReservation[] = []
    for (const group of grouped.values()) {
      group.sort((a, b) => a.cell.date.localeCompare(b.cell.date))
      let run: Occ[] = []
      const flush = () => {
        if (!run.length) return
        const first = run[0], last = run[run.length - 1]
        out.push({
          kind: first.kind,
          berthName: first.cell.berthName,
          berthLengthFt: first.cell.berthLengthFt,
          entityKey: first.key,
          vesselDisplay: first.kind === 'vessel' ? first.display : null,
          title: first.kind === 'event' ? first.title : null,
          startDate: first.cell.date,
          endDate: last.cell.date,
          days: run.length,
          refs: run.map((o) => o.cell.ref),
          sourceKey: `${first.cell.berthName}|${first.key}|${first.cell.date}|${last.cell.date}`,
        })
        run = []
      }
      for (const o of group) {
        if (run.length && addDays(run[run.length - 1].cell.date, 1) !== o.cell.date) flush()
        run.push(o)
      }
      flush()
    }
    return out
  }

  const reservations = [...runs([...byBerthDay.values()]), ...runs(extras)]
  reservations.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.berthName.localeCompare(b.berthName))
  return { reservations, annotations, duplicateCells }
}
