import { readFileSync } from 'node:fs'
import pkg from 'xlsx'
import { parseYearSheet, type SheetParse } from './grid'
import { parseVesselName, extractLengthFt, type VesselName } from './normalize'

const XLSX: any = pkg

export type RefVessel = {
  name: VesselName
  /** Length we will trust, and why it might be contested. */
  lengthFt: number | null
  lengthFromName: number | null
  lengthFromLoa: number | null
  conflict: boolean
  tab: string
  ref: string
}

export function loadWorkbook(path: string) {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true })
  const sheetGrid = (name: string): (string | null)[][] => {
    const ws = wb.Sheets[name]
    if (!ws || !ws['!ref']) return []
    const range = XLSX.utils.decode_range(ws['!ref'])
    const out: (string | null)[][] = []
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: (string | null)[] = []
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        const v = cell ? String(cell.w ?? cell.v).trim() : ''
        row.push(v === '' ? null : v)
      }
      out.push(row)
    }
    return out
  }
  return { wb, sheetGrid, sheetNames: wb.SheetNames as string[] }
}

export function parseAllYears(wbh: ReturnType<typeof loadWorkbook>) {
  const years = wbh.sheetNames.filter((n) => /^\d{4}$/.test(n)).sort()
  const per: Record<string, SheetParse> = {}
  for (const y of years) per[y] = parseYearSheet(y, wbh.sheetGrid(y), Number(y))
  return { years, per }
}

/**
 * Builds the vessel registry from the Science and Yachts tabs.
 *
 * Those tabs are free-form: contact details spill into arbitrary columns and a
 * vessel's length is written either into its name ("R/V High Drift 120'") or in
 * a separate "LOA: 65', Draft: 4'" cell beside it - and sometimes both, with
 * different numbers. Where they disagree we keep the LARGER value and flag it:
 * understating a length is the mistake that puts a 65 ft boat on a 55 ft berth.
 */
export function parseVesselRegistry(wbh: ReturnType<typeof loadWorkbook>, tabs = ['Science', 'Yachts']): RefVessel[] {
  const out = new Map<string, RefVessel>()
  for (const tab of tabs) {
    const grid = wbh.sheetGrid(tab)
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const v = grid[r][c]
        if (!v) continue
        const parsed = parseVesselName(v)
        if (!parsed) continue

        // An "LOA:" cell anywhere on the same row belongs to this vessel.
        let loa: number | null = null
        for (const other of grid[r]) {
          if (!other || other === v) continue
          if (/LOA:/i.test(other)) { loa = extractLengthFt(other); break }
        }

        const fromName = parsed.lengthFt
        const lengths = [fromName, loa].filter((n): n is number => n != null)
        const lengthFt = lengths.length ? Math.max(...lengths) : null
        const conflict = fromName != null && loa != null && fromName !== loa

        const existing = out.get(parsed.key)
        if (existing) {
          // Same vessel listed twice: keep the longest length on record.
          if (lengthFt != null && (existing.lengthFt == null || lengthFt > existing.lengthFt)) {
            existing.lengthFt = lengthFt
          }
          existing.conflict = existing.conflict || conflict
          continue
        }
        out.set(parsed.key, {
          name: parsed,
          lengthFt,
          lengthFromName: fromName,
          lengthFromLoa: loa,
          conflict,
          tab,
          ref: `${tab}!R${r + 1}C${c + 1}`,
        })
      }
    }
  }
  return [...out.values()]
}
