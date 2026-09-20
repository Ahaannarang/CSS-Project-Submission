/**
 * Turns the year sheets into (berth, day, text) cells.
 *
 * The layout drifted over 23 years:
 *   1997-2013  month header "AUGUST 1997" in column A; day numbers sometimes on
 *              the header row, sometimes on their own row, sometimes only "1"
 *              with the rest implied by position.
 *   2014-2019  month header is just "January"; the grid starts a column later;
 *              two extra un-lengthed sections ("North Finger Piers") appear.
 *
 * Rather than special-casing years, each month block is located on its own and
 * its day columns are derived from what the block actually contains.
 *
 * Every non-empty cell ends up in exactly one bucket, so nothing is lost:
 *   cells          a berth row crossed with a dated column -> a real booking
 *   berthless      a dated column, but the row carries no berth label. The old
 *                  grid's way of writing a second entry for a day that was
 *                  already full, so this is where double-bookings hide.
 *   undated        a berth row, but a column outside the month's dates
 *   orphans        anything else (malformed blocks, stray labels)
 */

import { parseBerthLabel } from './normalize'

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]
const WEEKDAY_TOKENS = new Set(['m', 't', 'w', 'tr', 'th', 'f', 's', 'su', 'sa'])

export type GridCell = {
  year: number
  month: number
  day: number
  date: string
  berthLabel: string
  berthName: string
  berthLengthFt: number | null
  text: string
  ref: string
}

export type BerthlessCell = { year: number; month: number; day: number; date: string; text: string; ref: string }
export type UndatedCell = { year: number; month: number; berthName: string | null; text: string; ref: string }
export type OrphanCell = { sheet: string; ref: string; text: string; reason: string }
export type YearMismatch = { ref: string; headerYear: number; sheetYear: number }

export type SheetParse = {
  cells: GridCell[]
  berthless: BerthlessCell[]
  undated: UndatedCell[]
  orphans: OrphanCell[]
  blocks: number
  weekdayMismatches: { ref: string; expected: string; found: string }[]
  yearMismatches: YearMismatch[]
}

function colName(c: number): string {
  let s = ''
  c += 1
  while (c > 0) {
    const r = (c - 1) % 26
    s = String.fromCharCode(65 + r) + s
    c = Math.floor((c - 1) / 26)
  }
  return s
}

function monthFromHeader(raw: string): { month: number; year: number | null } | null {
  const s = raw.replace(/\s+/g, ' ').trim().toLowerCase()
  const m = s.match(/^([a-z]+)\.?(?:\s+(\d{4}))?$/)
  if (!m) return null
  const idx = MONTHS.findIndex((mo) => mo === m[1] || (m[1].length >= 3 && mo.startsWith(m[1])))
  if (idx === -1) return null
  return { month: idx + 1, year: m[2] ? Number(m[2]) : null }
}

/** Excel's weekday letters: TR = Thursday; S covers both Saturday and Sunday. */
function weekdayMatches(token: string, jsDay: number): boolean {
  const t = token.trim().toLowerCase()
  if (!t) return true
  switch (jsDay) {
    case 0: return t === 's' || t === 'su' || t === 'sun'
    case 1: return t === 'm' || t === 'mon'
    case 2: return t === 't' || t === 'tu' || t === 'tue'
    case 3: return t === 'w' || t === 'wed'
    case 4: return t === 'tr' || t === 'th' || t === 'thu'
    case 5: return t === 'f' || t === 'fri'
    case 6: return t === 's' || t === 'sa' || t === 'sat'
  }
  return true
}

/**
 * A weekday header row is one whose cells are all weekday letters. A full month
 * has 28-31 of them, but a truncated or partial block has fewer, so the test
 * scales: a long row may carry a stray note, a short one must be unanimous.
 */
function isWeekdayRow(row: (string | null)[]): boolean {
  const vals = row.slice(1).filter((v) => v != null && v !== '') as string[]
  if (vals.length < 3) return false
  const hits = vals.filter((v) => WEEKDAY_TOKENS.has(v.trim().toLowerCase())).length
  return vals.length >= 10 ? hits / vals.length > 0.8 : hits === vals.length
}

function dayRowInfo(row: (string | null)[]): { firstCol: number; map: Map<number, number> } | null {
  const map = new Map<number, number>()
  let firstCol = -1
  let n = 0
  for (let c = 1; c < row.length; c++) {
    const v = row[c]
    if (v == null || String(v).trim() === '') continue
    const num = Number(String(v).trim())
    if (!Number.isInteger(num) || num < 1 || num > 31) return null
    if (num === 1 && firstCol === -1) firstCol = c
    map.set(c, num)
    n++
  }
  if (firstCol === -1 || n === 0) return null
  return { firstCol, map }
}

export function parseYearSheet(
  sheetName: string,
  grid: (string | null)[][],
  sheetYear: number,
): SheetParse {
  const out: SheetParse = {
    cells: [], berthless: [], undated: [], orphans: [],
    blocks: 0, weekdayMismatches: [], yearMismatches: [],
  }
  const consumed: boolean[][] = grid.map((r) => r.map(() => false))
  const width = Math.max(1, ...grid.map((r) => r.length))

  // 1. Locate every month header, then treat the rows up to the next one as its block.
  //
  //    Header years are not always the sheet's year, and the two cases look alike
  //    but must be handled oppositely:
  //      - 2002/2003/2004 legitimately open with the PREVIOUS December, a real
  //        carry-over block. Overriding it would drop that month's bookings into
  //        the wrong December and invent conflicts with the real one.
  //      - 2010 ends with "NOVEMBER 2018"/"DECEMBER 2018", plain typos sitting in
  //        month order after October 2010.
  //    A header year is trusted when it is within a year of the sheet and sits
  //    where such a carry-over belongs; otherwise it is treated as a typo.
  const raw: { row: number; month: number; headerYear: number | null }[] = []
  for (let r = 0; r < grid.length; r++) {
    const a = grid[r]?.[0]
    if (a == null || String(a).trim() === '') continue
    const head = monthFromHeader(String(a))
    if (!head) continue
    raw.push({ row: r, month: head.month, headerYear: head.year })
    consumed[r][0] = true
  }

  const headers: { row: number; month: number; year: number }[] = []
  raw.forEach((h, i) => {
    let year = sheetYear
    if (h.headerYear != null && h.headerYear !== sheetYear) {
      const leadingCarryOver = i === 0 && h.headerYear === sheetYear - 1 && h.month === 12
      const trailingCarryOver = i === raw.length - 1 && h.headerYear === sheetYear + 1 && h.month === 1
      if (leadingCarryOver || trailingCarryOver) {
        year = h.headerYear
      } else {
        out.yearMismatches.push({ ref: `${sheetName}!A${h.row + 1}`, headerYear: h.headerYear, sheetYear })
      }
    }
    headers.push({ row: h.row, month: h.month, year })
  })
  out.blocks = headers.length

  for (let h = 0; h < headers.length; h++) {
    const { row: start, month, year } = headers[h]
    const end = h + 1 < headers.length ? headers[h + 1].row : grid.length

    // 2. The day-number row is usually just below the header, occasionally above it.
    let dayRow: { firstCol: number; map: Map<number, number> } | null = null
    let dayRowIdx = -1
    for (const cand of [start, start + 1, start + 2, start - 1, start - 2]) {
      if (cand < 0 || cand >= grid.length) continue
      if (cand !== start && headers.some((x) => x.row === cand)) continue
      const info = dayRowInfo(grid[cand])
      if (info) { dayRow = info; dayRowIdx = cand; break }
    }
    if (!dayRow) {
      out.orphans.push({
        sheet: sheetName, ref: `${sheetName}!A${start + 1}`,
        text: String(grid[start][0]), reason: 'month block has no day-number row',
      })
      continue
    }
    for (const c of dayRow.map.keys()) consumed[dayRowIdx][c] = true

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const colToDay = new Map<number, number>()
    for (let c = dayRow.firstCol; c < width; c++) {
      const day = dayRow.map.get(c) ?? c - dayRow.firstCol + 1
      if (day >= 1 && day <= daysInMonth) colToDay.set(c, day)
    }

    // 3. Cross-check the column mapping against the weekday row. A mismatch would
    //    shift every booking in the block, so it is reported rather than assumed.
    let weekdayRowIdx = -1
    for (const cand of [dayRowIdx + 1, dayRowIdx - 1, start + 1, start + 2]) {
      if (cand < 0 || cand >= grid.length || cand === dayRowIdx) continue
      if (!isWeekdayRow(grid[cand])) continue
      weekdayRowIdx = cand
      for (const [c, day] of colToDay) {
        const tok = grid[cand][c]
        if (tok == null || String(tok).trim() === '') continue
        const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
        if (!weekdayMatches(String(tok), jsDay)) {
          out.weekdayMismatches.push({
            ref: `${sheetName}!${colName(c)}${cand + 1}`,
            expected: ['S', 'M', 'T', 'W', 'TR', 'F', 'S'][jsDay],
            found: String(tok),
          })
        }
      }
      for (let c = 0; c < width; c++) {
        const tok = grid[cand]?.[c]
        if (tok != null && WEEKDAY_TOKENS.has(String(tok).trim().toLowerCase())) consumed[cand][c] = true
      }
      break
    }

    // 4. Walk the block. Berth rows produce bookings; everything else is still
    //    recorded, tagged with whatever we do know about it.
    for (let r = start; r < end; r++) {
      if (r === dayRowIdx || r === weekdayRowIdx) continue
      const labelRaw = grid[r]?.[0]
      const labelText = labelRaw == null ? '' : String(labelRaw).trim()
      const berth = labelText && !monthFromHeader(labelText) ? parseBerthLabel(labelText) : null
      if (berth) consumed[r][0] = true

      for (let c = 1; c < width; c++) {
        const v = grid[r]?.[c]
        if (v == null || String(v).trim() === '' || consumed[r][c]) continue
        const text = String(v).trim()
        const day = colToDay.get(c)
        consumed[r][c] = true
        const ref = `${sheetName}!${colName(c)}${r + 1}`

        if (berth && day != null) {
          out.cells.push({
            year, month, day,
            date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            berthLabel: labelText, berthName: berth.name, berthLengthFt: berth.lengthFt,
            text, ref,
          })
        } else if (day != null) {
          out.berthless.push({
            year, month, day,
            date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            text, ref,
          })
        } else {
          out.undated.push({ year, month, berthName: berth ? berth.name : null, text, ref })
        }
      }
    }
  }

  // 5. Whatever no block claimed at all.
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r] ?? []).length; c++) {
      const v = grid[r][c]
      if (v == null || String(v).trim() === '' || consumed[r][c]) continue
      const text = String(v).trim()
      if (/Pier & Dock Schedule|Harborview|Contact:/i.test(text)) continue
      if (c === 0 && parseBerthLabel(text) && /\d/.test(text)) continue   // berth label outside a block
      out.orphans.push({
        sheet: sheetName, ref: `${sheetName}!${colName(c)}${r + 1}`, text,
        reason: c === 0 ? 'label outside any month block' : 'entry outside any month block',
      })
    }
  }

  return out
}
