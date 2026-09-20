import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { sql, resetSchema, truncate, makeBerth, makeVessel, book, expectFailure, range } from './helpers'

let berth: number, small: number, exact: number, oversize: number

beforeAll(async () => { await resetSchema() })
afterAll(async () => { await sql.end() })

beforeEach(async () => {
  await truncate()
  berth = await makeBerth('Berth 3', 50)
  small = await makeVessel('R/V Small', 40)
  exact = await makeVessel('R/V Exact', 50)
  oversize = await makeVessel('R/V Oversize', 51)
})

describe('the no-double-booking rule', () => {
  it('rejects two bookings with exactly the same dates', async () => {
    await book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-05' })
    const err = await expectFailure(() => book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-05' }))
    expect(err?.code).toBe('23P01')
  })

  it('rejects an overlap that starts inside an existing booking', async () => {
    await book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-05' })
    const err = await expectFailure(() => book({ berthId: berth, vesselId: small, start: '2026-06-04', end: '2026-06-09' }))
    expect(err?.code).toBe('23P01')
  })

  it('rejects an overlap that ends inside an existing booking', async () => {
    await book({ berthId: berth, vesselId: small, start: '2026-06-10', end: '2026-06-20' })
    const err = await expectFailure(() => book({ berthId: berth, vesselId: small, start: '2026-06-05', end: '2026-06-12' }))
    expect(err?.code).toBe('23P01')
  })

  it('rejects a booking entirely inside another', async () => {
    await book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-30' })
    const err = await expectFailure(() => book({ berthId: berth, vesselId: small, start: '2026-06-10', end: '2026-06-12' }))
    expect(err?.code).toBe('23P01')
  })

  it('allows back-to-back bookings (Jun 1-5, then Jun 6-10)', async () => {
    await book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-05' })
    const id = await book({ berthId: berth, vesselId: small, start: '2026-06-06', end: '2026-06-10' })
    expect(id).toBeGreaterThan(0)
  })

  it('rejects same-day turnover: one leaves the day the next arrives (A7)', async () => {
    await book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-05' })
    const err = await expectFailure(() => book({ berthId: berth, vesselId: small, start: '2026-06-05', end: '2026-06-09' }))
    expect(err?.code).toBe('23P01')
  })

  it('lets the same dates be booked on a different berth', async () => {
    const other = await makeBerth('Berth 4', 60)
    await book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-05' })
    const id = await book({ berthId: other, vesselId: small, start: '2026-06-01', end: '2026-06-05' })
    expect(id).toBeGreaterThan(0)
  })

  it('frees the berth as soon as a booking is cancelled', async () => {
    const first = await book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-05' })
    await sql`UPDATE reservations SET status = 'cancelled' WHERE id = ${first}`
    const id = await book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-05' })
    expect(id).toBeGreaterThan(0)
  })

  it('lets flagged legacy rows overlap, so history still loads (A8)', async () => {
    await book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-05' })
    const id = await book({ berthId: berth, vesselId: small, start: '2026-06-02', end: '2026-06-04', status: 'flagged' })
    expect(id).toBeGreaterThan(0)
  })

  it('catches an overlap created by EDITING an existing booking', async () => {
    await book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-05' })
    const second = await book({ berthId: berth, vesselId: small, start: '2026-06-20', end: '2026-06-25' })
    const err = await expectFailure(() =>
      sql`UPDATE reservations SET during = ${range('2026-06-03', '2026-06-08')}::daterange WHERE id = ${second}`)
    expect(err?.code).toBe('23P01')
  })
})

describe('the fit rule', () => {
  it('allows a vessel exactly as long as the berth when the margin is 0', async () => {
    const id = await book({ berthId: berth, vesselId: exact, start: '2026-06-01', end: '2026-06-02' })
    expect(id).toBeGreaterThan(0)
  })

  it('rejects a vessel one foot too long', async () => {
    const err = await expectFailure(() => book({ berthId: berth, vesselId: oversize, start: '2026-06-01', end: '2026-06-02' }))
    expect(err?.code).toBe('23514')
    expect(err?.message).toContain('R/V Oversize is 51 ft; Berth 3 is 50 ft')
  })

  it('applies the configured clearance margin', async () => {
    await sql`UPDATE settings SET value = 5 WHERE key = 'margin_ft'`
    const err = await expectFailure(() => book({ berthId: berth, vesselId: exact, start: '2026-06-01', end: '2026-06-02' }))
    expect(err?.code).toBe('23514')
    const id = await book({ berthId: berth, vesselId: small, start: '2026-07-01', end: '2026-07-02' })  // 40 + 5 <= 50
    expect(id).toBeGreaterThan(0)
    await sql`UPDATE settings SET value = 0 WHERE key = 'margin_ft'`
  })

  it('cannot be checked when the vessel has no length, and does not block the booking', async () => {
    const unknown = await makeVessel('R/V Unknown', null)
    const id = await book({ berthId: berth, vesselId: unknown, start: '2026-06-01', end: '2026-06-02' })
    expect(id).toBeGreaterThan(0)
  })

  it('cannot be checked when the berth has no length', async () => {
    const unlengthed = await makeBerth('North Finger Piers', null)
    const id = await book({ berthId: unlengthed, vesselId: oversize, start: '2026-06-01', end: '2026-06-02' })
    expect(id).toBeGreaterThan(0)
  })

  it('still rejects a misfit introduced by EDITING a booking onto a shorter berth', async () => {
    const big = await makeBerth('Berth 9', 100)
    const id = await book({ berthId: big, vesselId: oversize, start: '2026-06-01', end: '2026-06-02' })
    const err = await expectFailure(() => sql`UPDATE reservations SET berth_id = ${berth} WHERE id = ${id}`)
    expect(err?.code).toBe('23514')
  })

  it('does not apply to flagged legacy rows', async () => {
    const id = await book({ berthId: berth, vesselId: oversize, start: '2026-06-01', end: '2026-06-02', status: 'flagged' })
    expect(id).toBeGreaterThan(0)
  })
})

describe('events', () => {
  it('blocks a vessel from a berth it occupies', async () => {
    await book({ berthId: berth, kind: 'event', title: 'Community sail day', start: '2026-06-01', end: '2026-06-02' })
    const err = await expectFailure(() => book({ berthId: berth, vesselId: small, start: '2026-06-02', end: '2026-06-03' }))
    expect(err?.code).toBe('23P01')
  })

  it('is blocked by a vessel already there', async () => {
    await book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-05' })
    const err = await expectFailure(() =>
      book({ berthId: berth, kind: 'event', title: 'Open house', start: '2026-06-03', end: '2026-06-04' }))
    expect(err?.code).toBe('23P01')
  })

  it('is rejected without a title', async () => {
    const err = await expectFailure(() => sql`
      INSERT INTO reservations (berth_id, vessel_id, kind, title, during)
      VALUES (${berth}, NULL, 'event', NULL, ${range('2026-06-01', '2026-06-02')}::daterange)`)
    expect(err?.code).toBe('23514')
    expect(err?.constraint_name).toBe('kind_shape')
  })

  it('has no length, so it fits any berth (A4)', async () => {
    const tiny = await makeBerth('Dinghy dock', 12)
    const id = await book({ berthId: tiny, kind: 'event', title: 'Science stroll', start: '2026-06-01', end: '2026-06-01' })
    expect(id).toBeGreaterThan(0)
  })

  it('rejects a vessel booking with no vessel', async () => {
    const err = await expectFailure(() => sql`
      INSERT INTO reservations (berth_id, vessel_id, kind, during)
      VALUES (${berth}, NULL, 'vessel', ${range('2026-06-01', '2026-06-02')}::daterange)`)
    expect(err?.constraint_name).toBe('kind_shape')
  })
})

describe('date handling', () => {
  it('rejects an end date before the start date', async () => {
    const err = await expectFailure(() => sql`
      INSERT INTO reservations (berth_id, vessel_id, kind, during)
      VALUES (${berth}, ${small}, 'vessel', ${'[2026-06-10,2026-06-05)'}::daterange)`)
    expect(err).not.toBeNull()
  })

  it('stores an inclusive single day as a one-day half-open range', async () => {
    const id = await book({ berthId: berth, vesselId: small, start: '2026-06-01', end: '2026-06-01' })
    const [r] = await sql`SELECT (upper(during) - lower(during))::int AS days FROM reservations WHERE id = ${id}`
    expect(r.days).toBe(1)
  })
})
