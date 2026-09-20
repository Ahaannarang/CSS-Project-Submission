import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { sql, resetSchema, truncate, makeBerth, makeVessel, book } from './helpers'
import { suggestBerths } from '@/lib/suggest'
import { sql as appSql } from '@/lib/db'

beforeAll(async () => { await resetSchema() })
afterAll(async () => { await sql.end(); await appSql.end() })

let b410: number, b240: number, b90a: number, b90b: number, b75: number, b55: number
let v72: number, v200: number, v500: number, vUnknown: number

beforeEach(async () => {
  await truncate()
  b410 = await makeBerth('North Pier West', 410)
  b240 = await makeBerth('North Pier East', 240)
  b90a = await makeBerth('South Float East', 90)
  b90b = await makeBerth('South Float West', 90)
  b75 = await makeBerth('North Pier Face', 75)
  b55 = await makeBerth('Inner Channel', 55)
  v72 = await makeVessel('R/V Seventy Two', 72)
  v200 = await makeVessel('R/V Two Hundred', 200)
  v500 = await makeVessel('R/V Enormous', 500)
  vUnknown = await makeVessel('R/V Mystery', null)
})

describe('the suggester', () => {
  it('puts the smallest berth that fits first', async () => {
    const r = await suggestBerths({ vesselId: v72, startDate: '2026-06-01', endDate: '2026-06-05' })
    expect(r.suggestions[0].name).toBe('North Pier Face')   // 75 ft, 3 ft spare
    expect(r.suggestions[0].label).toBe('Best fit')
    expect(r.suggestions[0].slack_ft).toBe(3)
  })

  it('leaves out berths the vessel does not fit', async () => {
    const r = await suggestBerths({ vesselId: v72, startDate: '2026-06-01', endDate: '2026-06-05' })
    expect(r.suggestions.map((s) => s.name)).not.toContain('Inner Channel')
  })

  it('orders by slack, then by name, so the list is deterministic', async () => {
    const r = await suggestBerths({ vesselId: v72, startDate: '2026-06-01', endDate: '2026-06-05' })
    expect(r.suggestions.map((s) => s.name)).toEqual([
      'North Pier Face', 'South Float East', 'South Float West', 'North Pier East', 'North Pier West',
    ])
    const again = await suggestBerths({ vesselId: v72, startDate: '2026-06-01', endDate: '2026-06-05' })
    expect(again.suggestions.map((s) => s.name)).toEqual(r.suggestions.map((s) => s.name))
  })

  it('drops a berth that is booked for any part of the stay', async () => {
    await book({ berthId: b75, vesselId: v72, start: '2026-06-03', end: '2026-06-03' })
    const r = await suggestBerths({ vesselId: v72, startDate: '2026-06-01', endDate: '2026-06-05' })
    expect(r.suggestions[0].name).toBe('South Float East')
  })

  it('keeps a berth whose booking ends the day before the stay begins', async () => {
    await book({ berthId: b75, vesselId: v72, start: '2026-05-25', end: '2026-05-31' })
    const r = await suggestBerths({ vesselId: v72, startDate: '2026-06-01', endDate: '2026-06-05' })
    expect(r.suggestions[0].name).toBe('North Pier Face')
  })

  it('ignores cancelled bookings', async () => {
    const id = await book({ berthId: b75, vesselId: v72, start: '2026-06-01', end: '2026-06-05' })
    await sql`UPDATE reservations SET status = 'cancelled' WHERE id = ${id}`
    const r = await suggestBerths({ vesselId: v72, startDate: '2026-06-01', endDate: '2026-06-05' })
    expect(r.suggestions[0].name).toBe('North Pier Face')
  })

  it('says so when no berth is long enough', async () => {
    const r = await suggestBerths({ vesselId: v500, startDate: '2026-06-01', endDate: '2026-06-05' })
    expect(r.suggestions).toHaveLength(0)
    expect(r.reason).toMatch(/No berth with a recorded length is long enough/)
    expect(r.alternatives).toHaveLength(0)     // shifting dates cannot help
  })

  it('distinguishes "all booked" from "none long enough"', async () => {
    for (const b of [b410, b240]) await book({ berthId: b, vesselId: v200, start: '2026-06-01', end: '2026-06-05' })
    const r = await suggestBerths({ vesselId: v200, startDate: '2026-06-01', endDate: '2026-06-05' })
    expect(r.suggestions).toHaveLength(0)
    expect(r.reason).toMatch(/All 2 berths that fit are booked/)
  })

  it('offers nearby dates when everything is taken', async () => {
    for (const b of [b410, b240]) await book({ berthId: b, vesselId: v200, start: '2026-06-01', end: '2026-06-05' })
    const r = await suggestBerths({ vesselId: v200, startDate: '2026-06-01', endDate: '2026-06-05' })
    expect(r.alternatives.length).toBeGreaterThan(0)
    expect(r.alternatives.some((a) => a.kind === 'shifted_dates' || a.kind === 'frees_up')).toBe(true)
  })

  it('offers every free berth for an event, since events have no length', async () => {
    const r = await suggestBerths({ vesselId: null, startDate: '2026-06-01', endDate: '2026-06-02' })
    expect(r.suggestions).toHaveLength(6)
  })

  it('cannot fit-check a vessel with no length, and says so', async () => {
    const r = await suggestBerths({ vesselId: vUnknown, startDate: '2026-06-01', endDate: '2026-06-02' })
    expect(r.fit_checked).toBe(false)
    expect(r.suggestions).toHaveLength(6)
  })

  it('ignores the booking being edited, so a date tweak does not exclude its own berth', async () => {
    const id = await book({ berthId: b75, vesselId: v72, start: '2026-06-01', end: '2026-06-05' })
    const without = await suggestBerths({ vesselId: v72, startDate: '2026-06-02', endDate: '2026-06-06' })
    expect(without.suggestions.map((s) => s.name)).not.toContain('North Pier Face')
    const with_ = await suggestBerths({ vesselId: v72, startDate: '2026-06-02', endDate: '2026-06-06', excludeReservationId: id })
    expect(with_.suggestions[0].name).toBe('North Pier Face')
  })

  // Regression: a berth with no recorded length used to be offered for ANY
  // vessel, because the fit filter treated NULL as "can't rule it out". In the
  // real data two berths have no length, so "nothing fits" could never fire.
  describe('berths with no recorded length', () => {
    it('are not ranked among the verified fits', async () => {
      const unknown = await makeBerth('North Finger Piers', null)
      const r = await suggestBerths({ vesselId: v500, startDate: '2026-06-01', endDate: '2026-06-05' })
      expect(r.suggestions.map((s) => s.berth_id)).not.toContain(unknown)
      expect(r.suggestions).toHaveLength(0)
    })

    it('are offered separately, labelled as unchecked', async () => {
      await makeBerth('North Finger Piers', null)
      const r = await suggestBerths({ vesselId: v500, startDate: '2026-06-01', endDate: '2026-06-05' })
      expect(r.unverified).toHaveLength(1)
      expect(r.unverified[0].label).toBe('Fit unknown')
      expect(r.reason).toMatch(/could not be checked/)
    })

    it('still count as ordinary suggestions for an event, which has no length', async () => {
      await makeBerth('North Finger Piers', null)
      const r = await suggestBerths({ vesselId: null, startDate: '2026-06-01', endDate: '2026-06-02' })
      expect(r.suggestions).toHaveLength(7)
      expect(r.unverified).toHaveLength(0)
    })

    it('are not used to pad the alternatives either', async () => {
      await makeBerth('North Finger Piers', null)
      for (const b of [b410, b240]) await book({ berthId: b, vesselId: v200, start: '2026-06-01', end: '2026-06-05' })
      const r = await suggestBerths({ vesselId: v200, startDate: '2026-06-01', endDate: '2026-06-05' })
      expect(r.alternatives.every((a) => a.name !== 'North Finger Piers')).toBe(true)
    })
  })

  it('respects the clearance margin', async () => {
    await sql`UPDATE settings SET value = 10 WHERE key = 'margin_ft'`
    const r = await suggestBerths({ vesselId: v72, startDate: '2026-06-01', endDate: '2026-06-05' })
    expect(r.suggestions[0].name).toBe('South Float East')   // 72 + 10 > 75, so the Face is out
    await sql`UPDATE settings SET value = 0 WHERE key = 'margin_ft'`
  })
})
