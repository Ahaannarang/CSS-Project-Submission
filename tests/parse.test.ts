import { describe, expect, it } from 'vitest'
import { parseVesselName, parseBerthLabel, extractLengthFt } from '@/lib/parse/normalize'
import { classifyCell } from '@/lib/parse/classify'
import { parseYearSheet } from '@/lib/parse/grid'
import { buildReservations } from '@/lib/parse/build'
import type { GridCell } from '@/lib/parse/grid'

describe('vessel names', () => {
  it('folds case and spacing so hand-typed variants become one vessel', () => {
    const a = parseVesselName('Barge SALT DORY')!
    const b = parseVesselName('Barge Salt Dory')!
    const c = parseVesselName('Barge  salt   dory ')!
    expect(a.key).toBe(b.key)
    expect(b.key).toBe(c.key)
    expect(a.display).toBe('Barge Salt Dory')
  })

  it('treats OSV and OS/V as the same designation', () => {
    expect(parseVesselName('OSV Golden Osprey')!.key).toBe(parseVesselName('OS/V Golden Osprey')!.key)
  })

  it('keeps different prefixes apart, because they are different boats', () => {
    // The reference tabs list R/V Iron Ketch at 46 ft and F/V Iron Ketch at 65 ft.
    expect(parseVesselName('R/V Iron Ketch')!.key).not.toBe(parseVesselName('F/V Iron Ketch')!.key)
  })

  it('pulls a length off the end of a name without keeping it in the name', () => {
    const v = parseVesselName("R/V High Drift 120'")!
    expect(v.lengthFt).toBe(120)
    expect(v.display).toBe('R/V High Drift')
  })

  it('is not fooled by text that merely mentions a boat', () => {
    expect(parseVesselName('Community sail day')).toBeNull()
    expect(parseVesselName('Fueling @0800')).toBeNull()
  })
})

describe('lengths', () => {
  it('reads LOA in preference to a trailing number', () => {
    expect(extractLengthFt("LOA: 145', Draft: 12'")).toBe(145)
  })
  it('reads a plain trailing length', () => {
    expect(extractLengthFt("M/Y Wild Tern 145'")).toBe(145)
  })
  it('converts metres to feet (A6)', () => {
    expect(extractLengthFt('22 m')).toBeCloseTo(72.2, 1)
  })
})

describe('berth labels', () => {
  it('splits the name from the length', () => {
    expect(parseBerthLabel("North Pier West - 410'")).toEqual({ name: 'North Pier West', lengthFt: 410 })
  })
  it('handles a section with no length at all', () => {
    expect(parseBerthLabel('North Finger Piers:')).toEqual({ name: 'North Finger Piers', lengthFt: null })
  })
})

describe('classifying a cell', () => {
  it('reads a vessel as a booking', () => {
    expect(classifyCell('R/V GOLDEN COMPASS')?.kind).toBe('vessel')
  })
  it('reads a sail day as an event that occupies the berth', () => {
    const m = classifyCell('Community sail day')
    expect(m?.kind).toBe('event')
    expect(m && 'category' in m && m.category).toBe('event')
  })
  it('reads pier work as an event, because the berth really is unavailable', () => {
    const m = classifyCell('Float rebuild - no usage permitted')
    expect(m?.kind).toBe('event')
    expect(m && 'category' in m && m.category).toBe('maintenance')
  })
  it('reads an arrival time as a note, not an occupancy', () => {
    // Booking these would invent conflicts that never happened.
    expect(classifyCell('ETA 1200')?.kind).toBe('annotation')
    expect(classifyCell('Fueling @0800')?.kind).toBe('annotation')
    expect(classifyCell('1030')?.kind).toBe('annotation')
  })
  it('sends anything it does not recognise to the audit rather than guessing', () => {
    expect(classifyCell('Something nobody wrote down properly')?.kind).toBe('annotation')
  })
})

describe('reading a month grid', () => {
  const grid = (rows: (string | null)[][]) => rows

  it('maps day columns and collapses a run into one stay', () => {
    const sheet = grid([
      ['JUNE 2006', '1', '2', '3', '4', '5'],
      [null, 'TR', 'F', 'S', 'S', 'M'],
      ["North Pier West - 410'", null, 'R/V Clear Sextant', 'R/V Clear Sextant', 'R/V Clear Sextant', null],
    ])
    const parsed = parseYearSheet('2006', sheet, 2006)
    expect(parsed.cells).toHaveLength(3)
    expect(parsed.weekdayMismatches).toHaveLength(0)
    const { reservations } = buildReservations(parsed.cells)
    expect(reservations).toHaveLength(1)
    expect(reservations[0].startDate).toBe('2006-06-02')
    expect(reservations[0].endDate).toBe('2006-06-04')
    expect(reservations[0].days).toBe(3)
  })

  it('starts a new stay when there is a gap', () => {
    const sheet = grid([
      ['JUNE 2006', '1', '2', '3', '4', '5'],
      [null, 'TR', 'F', 'S', 'S', 'M'],
      ["North Pier West - 410'", 'R/V A', 'R/V A', null, 'R/V A', null],
    ])
    const { reservations } = buildReservations(parseYearSheet('2006', sheet, 2006).cells)
    expect(reservations).toHaveLength(2)
    expect(reservations.map((r) => r.days)).toEqual([2, 1])
  })

  it('handles the 2014 layout where the grid starts a column later', () => {
    const sheet = grid([
      ['January', null, '1', '2', '3'],
      [null, null, 'W', 'TR', 'F'],
      ["North Pier West - 410'", null, 'R/V Golden Compass', null, null],
    ])
    const parsed = parseYearSheet('2014', sheet, 2014)
    expect(parsed.weekdayMismatches).toHaveLength(0)     // Jan 1 2014 really was a Wednesday
    expect(parsed.cells[0].date).toBe('2014-01-01')
  })

  it('notices when a weekday header disagrees with the calendar', () => {
    const sheet = grid([
      ['JUNE 2006', '1', '2', '3'],
      [null, 'M', 'T', 'W'],                              // Jun 1 2006 was a Thursday
      ["North Pier West - 410'", 'R/V A', null, null],
    ])
    expect(parseYearSheet('2006', sheet, 2006).weekdayMismatches.length).toBeGreaterThan(0)
  })

  it('keeps an entry written below the berth rows, flagged as having no berth', () => {
    const sheet = grid([
      ['JUNE 2006', '1', '2', '3'],
      [null, 'TR', 'F', 'S'],
      ["North Pier West - 410'", 'R/V A', null, null],
      [null, null, 'R/V B', null],                        // spilled onto the line below
    ])
    const parsed = parseYearSheet('2006', sheet, 2006)
    expect(parsed.cells).toHaveLength(1)
    expect(parsed.berthless).toHaveLength(1)
    expect(parsed.berthless[0]).toMatchObject({ date: '2006-06-02', text: 'R/V B' })
  })

  it('keeps an entry in a column outside the month, flagged as undated', () => {
    const sheet = grid([
      ['January', null, '1', '2', '3'],
      [null, null, 'W', 'TR', 'F'],
      ["North Pier West - 410'", 'R/V Stale', 'R/V Real', null, null],   // col B has no date
    ])
    const parsed = parseYearSheet('2014', sheet, 2014)
    expect(parsed.cells).toHaveLength(1)
    expect(parsed.undated).toHaveLength(1)
    expect(parsed.undated[0].text).toBe('R/V Stale')
  })

  it('trusts a leading December header from the previous year (a real carry-over block)', () => {
    const sheet = grid([
      ['DECEMBER 2001', '1', '2'],
      [null, 'S', 'S'],
      ["North Pier East - 240'", 'Barge SALT DORY', null],
    ])
    const parsed = parseYearSheet('2002', sheet, 2002)
    expect(parsed.cells[0].date).toBe('2001-12-01')
    expect(parsed.yearMismatches).toHaveLength(0)
  })

  it('treats an out-of-sequence header year as a typo and reports it', () => {
    const sheet = grid([
      ['JANUARY 2010', '1', '2'],
      [null, 'F', 'S'],
      ["North Pier East - 240'", 'R/V A', null],
      ['NOVEMBER 2018', '1', '2'],
      [null, 'M', 'T'],
      ["North Pier East - 240'", 'R/V B', null],
    ])
    const parsed = parseYearSheet('2010', sheet, 2010)
    expect(parsed.yearMismatches).toHaveLength(1)
    expect(parsed.cells.find((c) => c.text === 'R/V B')!.date).toBe('2010-11-01')
  })
})

describe('building stays', () => {
  const cell = (over: Partial<GridCell>): GridCell => ({
    year: 2006, month: 6, day: 1, date: '2006-06-01',
    berthLabel: "North Pier West - 410'", berthName: 'North Pier West', berthLengthFt: 410,
    text: 'R/V A', ref: '2006!B1', ...over,
  })

  it('collapses the same vessel on consecutive days into one stay', () => {
    const { reservations } = buildReservations([
      cell({ date: '2006-06-01' }), cell({ date: '2006-06-02' }), cell({ date: '2006-06-03' }),
    ])
    expect(reservations).toHaveLength(1)
    expect(reservations[0].days).toBe(3)
  })

  it('does not merge two different vessels that happen to be adjacent', () => {
    const { reservations } = buildReservations([
      cell({ date: '2006-06-01', text: 'R/V A' }), cell({ date: '2006-06-02', text: 'R/V B' }),
    ])
    expect(reservations).toHaveLength(2)
  })

  it('merges name variants of one vessel into a single stay', () => {
    const { reservations } = buildReservations([
      cell({ date: '2006-06-01', text: 'Barge SALT DORY' }),
      cell({ date: '2006-06-02', text: 'Barge Salt Dory' }),
    ])
    expect(reservations).toHaveLength(1)
    expect(reservations[0].days).toBe(2)
  })

  it('collapses an identical duplicate of the same berth-day', () => {
    const { reservations, duplicateCells } = buildReservations([
      cell({ date: '2006-06-01', ref: '2001!B1' }), cell({ date: '2006-06-01', ref: '2002!B5' }),
    ])
    expect(reservations).toHaveLength(1)
    expect(duplicateCells).toHaveLength(1)
  })

  it('keeps BOTH occupants when one berth-day names two different vessels', () => {
    const { reservations } = buildReservations([
      cell({ date: '2006-06-01', text: 'R/V A' }), cell({ date: '2006-06-01', text: 'R/V B' }),
    ])
    expect(reservations).toHaveLength(2)   // the database will then reject one as an overlap
  })

  it('records a note without turning it into a booking', () => {
    const { reservations, annotations } = buildReservations([cell({ text: 'ETA 1200' })])
    expect(reservations).toHaveLength(0)
    expect(annotations).toHaveLength(1)
  })

  it('gives each stay a stable key so re-importing changes nothing', () => {
    const cells = [cell({ date: '2006-06-01' }), cell({ date: '2006-06-02' })]
    expect(buildReservations(cells).reservations[0].sourceKey)
      .toBe(buildReservations(cells).reservations[0].sourceKey)
  })
})
