import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { sql, resetSchema, truncate, makeBerth, makeVessel, book } from './helpers'
import { findOpenings } from '@/lib/availability'
import { sql as appSql } from '@/lib/db'

beforeAll(async () => { await resetSchema() })
afterAll(async () => { await sql.end(); await appSql.end() })

let b90: number, b75: number, b55: number, bUnknown: number, v72: number, v500: number

beforeEach(async () => {
  await truncate()
  b90 = await makeBerth('South Float', 90)
  b75 = await makeBerth('Pier Face', 75)
  b55 = await makeBerth('Inner Channel', 55)
  bUnknown = await makeBerth('Finger Piers', null)
  v72 = await makeVessel('R/V Seventy Two', 72)
  v500 = await makeVessel('R/V Enormous', 500)
})

describe('finding the earliest opening', () => {
  it('offers the requested date when everything is free', async () => {
    const r = await findOpenings({ vesselId: v72, days: 5, from: '2027-06-01' })
    expect(r.openings[0].start_date).toBe('2027-06-01')
    expect(r.openings[0].end_date).toBe('2027-06-05')
  })

  it('ranks the snuggest fit first among equally early berths', async () => {
    const r = await findOpenings({ vesselId: v72, days: 5, from: '2027-06-01' })
    expect(r.openings[0].name).toBe('Pier Face')      // 75 ft beats 90 ft
  })

  it('leaves out berths the vessel does not fit', async () => {
    const r = await findOpenings({ vesselId: v72, days: 5, from: '2027-06-01' })
    expect(r.openings.map((o) => o.name)).not.toContain('Inner Channel')
  })

  it('leaves out berths whose length is unknown, since fit cannot be checked', async () => {
    const r = await findOpenings({ vesselId: v72, days: 5, from: '2027-06-01' })
    expect(r.openings.map((o) => o.name)).not.toContain('Finger Piers')
  })

  it('includes every berth for an event, which has no length', async () => {
    const r = await findOpenings({ vesselId: null, days: 2, from: '2027-06-01' })
    expect(r.openings).toHaveLength(4)
    expect(r.fit_checked).toBe(false)
  })

  it('starts the day after an existing booking ends', async () => {
    await book({ berthId: b75, vesselId: v72, start: '2027-06-01', end: '2027-06-10' })
    const r = await findOpenings({ vesselId: v72, days: 5, from: '2027-06-01' })
    const face = r.openings.find((o) => o.berth_id === b75)!
    expect(face.start_date).toBe('2027-06-11')
  })

  it('uses a gap between two bookings when it is long enough', async () => {
    await book({ berthId: b75, vesselId: v72, start: '2027-06-01', end: '2027-06-05' })
    await book({ berthId: b75, vesselId: v72, start: '2027-06-16', end: '2027-06-30' })
    const r = await findOpenings({ vesselId: v72, days: 5, from: '2027-06-01' })
    const face = r.openings.find((o) => o.berth_id === b75)!
    expect(face.start_date).toBe('2027-06-06')     // 10-day gap fits a 5-day stay
    expect(face.window_days).toBe(10)
  })

  it('skips a gap that is too short and takes the next one', async () => {
    await book({ berthId: b75, vesselId: v72, start: '2027-06-01', end: '2027-06-05' })
    await book({ berthId: b75, vesselId: v72, start: '2027-06-09', end: '2027-06-20' })
    const r = await findOpenings({ vesselId: v72, days: 5, from: '2027-06-01' })
    const face = r.openings.find((o) => o.berth_id === b75)!
    expect(face.start_date).toBe('2027-06-21')     // the 3-day gap is not enough
  })

  it('returns openings soonest first', async () => {
    await book({ berthId: b75, vesselId: v72, start: '2027-06-01', end: '2027-06-20' })
    const r = await findOpenings({ vesselId: v72, days: 5, from: '2027-06-01' })
    expect(r.openings[0].name).toBe('South Float')
    expect(r.openings[0].start_date).toBe('2027-06-01')
  })

  it('ignores cancelled bookings', async () => {
    const id = await book({ berthId: b75, vesselId: v72, start: '2027-06-01', end: '2027-06-20' })
    await sql`UPDATE reservations SET status = 'cancelled' WHERE id = ${id}`
    const r = await findOpenings({ vesselId: v72, days: 5, from: '2027-06-01' })
    expect(r.openings.find((o) => o.berth_id === b75)!.start_date).toBe('2027-06-01')
  })

  it('treats a flagged legacy booking as not occupying the berth', async () => {
    await book({ berthId: b75, vesselId: v72, start: '2027-06-01', end: '2027-06-20', status: 'flagged' })
    const r = await findOpenings({ vesselId: v72, days: 5, from: '2027-06-01' })
    expect(r.openings.find((o) => o.berth_id === b75)!.start_date).toBe('2027-06-01')
  })

  it('says plainly when no berth could ever take the vessel', async () => {
    const r = await findOpenings({ vesselId: v500, days: 5, from: '2027-06-01' })
    expect(r.openings).toHaveLength(0)
    expect(r.reason).toMatch(/No berth with a recorded length is long enough/)
  })

  it('reports how far away the opening is', async () => {
    await book({ berthId: b75, vesselId: v72, start: '2027-06-01', end: '2027-06-10' })
    const r = await findOpenings({ vesselId: v72, days: 5, from: '2027-06-01' })
    const face = r.openings.find((o) => o.berth_id === b75)!
    expect(face.starts_in_days).toBe(10)
    expect(face.reason).toMatch(/10 days later/)
  })

  it('honours the clearance margin', async () => {
    await sql`UPDATE settings SET value = 10 WHERE key = 'margin_ft'`
    const r = await findOpenings({ vesselId: v72, days: 5, from: '2027-06-01' })
    expect(r.openings.map((o) => o.name)).not.toContain('Pier Face')   // 72 + 10 > 75
    await sql`UPDATE settings SET value = 0 WHERE key = 'margin_ft'`
  })

  it('never suggests a window that the booking rules would then refuse', async () => {
    await book({ berthId: b75, vesselId: v72, start: '2027-06-01', end: '2027-06-10' })
    await book({ berthId: b90, vesselId: v72, start: '2027-06-01', end: '2027-06-03' })
    const r = await findOpenings({ vesselId: v72, days: 4, from: '2027-06-01' })
    // Every suggested window must actually be insertable.
    for (const o of r.openings) {
      const id = await book({ berthId: o.berth_id, vesselId: v72, start: o.start_date, end: o.end_date })
      expect(id).toBeGreaterThan(0)
      await sql`DELETE FROM reservations WHERE id = ${id}`
    }
  })
})
