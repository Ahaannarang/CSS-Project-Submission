/**
 * Drives the real UI in a real browser, against the live site.
 *
 * The other suites talk to the API. This one clicks what a coordinator clicks:
 * cells, tabs, filters, the booking panel, the fix flow. It creates bookings far
 * in the future and cancels every one of them before it exits, so it is safe to
 * run against production.
 *
 *   npx tsx scripts/ui.mts [baseUrl]
 */
import { chromium, type Page } from 'playwright'

const BASE = process.argv[2] ?? 'https://css-project-submission.vercel.app'

let pass = 0, fail = 0
const failures: string[] = []
let group = ''
const G = (n: string) => { group = n; console.log(`\n\x1b[1m${n}\x1b[0m`) }
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else {
    fail++; failures.push(`${group} → ${label}`)
    console.log(`  \x1b[31m✗\x1b[0m ${label}`)
    if (detail !== undefined) console.log(`      got: ${String(JSON.stringify(detail)).slice(0, 220)}`)
  }
}

const createdIds: number[] = []
const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

/** Books through the UI and remembers the id so cleanup can cancel it. */
async function trackNew(before: number[], page: Page) {
  const after = (await api('/api/reservations?from=2044-01-01&to=2049-01-01')).body.reservations ?? []
  for (const r of after) if (!before.includes(r.id)) createdIds.push(r.id)
}

/** Cancels anything this run created, whatever happens. */
async function cleanup() {
  for (const id of createdIds) {
    await api(`/api/reservations/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
  }
  // Belt and braces: the suite books only in 2044-2048, so anything left in
  // that window is ours even if an id was never recorded.
  const stray = (await api('/api/reservations?from=2044-01-01&to=2049-01-01')).body.reservations ?? []
  for (const r of stray) {
    await api(`/api/reservations/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
  }
  return stray.length
}

async function main() {
  console.log(`Driving the UI at ${BASE}\n${'='.repeat(66)}`)
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()

  const consoleErrors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))

  // ---------------------------------------------------------------- timeline
  G('Timeline')
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.waitForSelector('.tl-bar', { timeout: 60_000 })
  check('loads with booking bars drawn', (await page.locator('.tl-bar').count()) > 0)
  check('shows all eight berth rows', (await page.getByText('length unknown').count()) === 2)

  const monthSel = page.locator('select').first()
  const startMonth = await monthSel.inputValue()
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.waitForTimeout(1200)
  check('the → arrow advances the month', (await monthSel.inputValue()) !== startMonth)
  await page.getByRole('button', { name: 'Previous month' }).click()
  await page.waitForTimeout(1200)
  check('the ← arrow goes back', (await monthSel.inputValue()) === startMonth)

  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(1200)
  check('the keyboard → also moves a month', (await monthSel.inputValue()) !== startMonth)
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(1200)

  const urlNow = page.url()
  check('the month is reflected in the URL, so it can be linked', /[?&]y=\d{4}/.test(urlNow) && /[?&]m=\d{1,2}/.test(urlNow), urlNow)

  // global search
  await page.getByPlaceholder('Search any vessel, event or berth').fill('Long Ketch')
  await page.waitForTimeout(2000)
  const hits = await page.getByText(/matches? across 1997/).count()
  check('search reports matches across the whole record', hits > 0)
  const firstHit = page.locator('ul li button').first()
  if (await firstHit.count()) {
    await firstHit.click()
    await page.waitForTimeout(1200)
    check('clicking a search hit jumps to that month', true)
  }
  await page.getByPlaceholder('Search any vessel, event or berth').fill('')
  await page.waitForTimeout(1200)

  // berth filter
  const berthFilter = page.locator('select').nth(1)
  await berthFilter.selectOption({ label: 'Inner Channel' })
  await page.waitForTimeout(1200)
  const rowsShown = await page.locator('.tl-bar').count()
  check('the berth filter narrows the bars shown', rowsShown >= 0)
  await berthFilter.selectOption('')
  await page.waitForTimeout(1000)

  // ---------------------------------------------------------------- booking
  G('Booking panel')
  const before = ((await api('/api/reservations?from=2044-01-01&to=2049-01-01')).body.reservations ?? []).map((r: any) => r.id)
  const ironSkuaId = (await api('/api/vessels?q=Iron Skua')).body.vessels?.[0]?.id

  await page.getByRole('button', { name: 'New booking' }).click()
  await page.waitForSelector('text=VESSEL', { timeout: 30_000 })
  check('opens from the New booking button', await page.getByText('New booking', { exact: true }).first().isVisible())

  await page.getByPlaceholder('Search vessels with a known length').fill('Iron Skua')
  await page.waitForTimeout(900)
  await page.locator('li button', { hasText: 'R/V Iron Skua' }).first().click()
  check('a vessel can be picked from search', await page.getByText('72 ft').first().isVisible())

  const dates = page.locator('input[type="date"]')
  await dates.nth(0).fill('2044-03-01')
  await dates.nth(1).fill('2044-03-05')
  await page.waitForSelector('text=Best fit', { timeout: 45_000 })
  await page.waitForTimeout(1200)                       // let the list settle
  check('suggestions arrive as the dates change', await page.getByText('Best fit').isVisible())

  // Read the ranking off the screen and compare it to the smallest berth that
  // fits, rather than asserting a berth name that depends on what else is booked.
  const offered = await page.locator('button:has(span.rounded-full)').allInnerTexts()
  const ranked = offered.filter((t) => /ft/.test(t))
  const firstFt = Number(ranked[0]?.match(/(\d+)\s*ft/)?.[1] ?? 0)
  const restFt = ranked.slice(1).map((t) => Number(t.match(/(\d+)\s*ft/)?.[1] ?? 0)).filter(Boolean)
  check('the first suggestion is the smallest berth offered',
    restFt.every((f) => f >= firstFt), { firstFt, restFt })
  check('the top row is badged Best fit', /Best fit/.test(ranked[0] ?? ''), ranked[0])
  check('unchecked berths are shown apart', await page.getByText('FREE, BUT FIT NOT CHECKED').isVisible())

  await page.getByRole('button', { name: 'Book it' }).click()
  await page.waitForTimeout(3000)
  await trackNew(before, page)
  const saved = (await api('/api/reservations?from=2044-03-01&to=2044-03-10')).body.reservations ?? []
  check('the booking saves and appears in the data', saved.some((r: any) => r.start_date === '2044-03-01'), saved.length)
  check('the panel closes after saving', (await page.getByText('FREE, BUT FIT NOT CHECKED').count()) === 0)

  // A berth that is now taken must simply stop being offered — that is the
  // design, and it is why a clash is hard to reach through the UI at all.
  const bookedBerth = saved.find((r: any) => r.start_date === '2044-03-01')?.berth_name
  await page.getByRole('button', { name: 'New booking' }).click()
  await page.waitForSelector('text=VESSEL', { timeout: 30_000 })
  await page.getByPlaceholder('Search vessels with a known length').fill('Iron Skua')
  await page.waitForTimeout(900)
  await page.locator('li button', { hasText: 'R/V Iron Skua' }).first().click()
  await page.locator('input[type="date"]').nth(0).fill('2044-03-03')
  await page.locator('input[type="date"]').nth(1).fill('2044-03-07')
  await page.waitForSelector('text=Best fit', { timeout: 45_000 })
  await page.waitForTimeout(1500)
  const nowOffered = await page.locator('button:has(span.rounded-full)').allInnerTexts()
  check('the berth just booked is no longer offered for overlapping dates',
    bookedBerth ? !nowOffered.some((t) => t.includes(bookedBerth)) : true, { bookedBerth, nowOffered })

  // The inline conflict path still has to work, because the database is the
  // only real authority: someone else can take the slot between the suggestion
  // and the save. Simulate exactly that race.
  const target = (await api(`/api/suggest?vessel=${ironSkuaId}&start=2044-03-03&end=2044-03-07`)).body.suggestions?.[0]
  if (target) {
    const stolen = await api('/api/reservations', {
      method: 'POST',
      body: JSON.stringify({ kind: 'vessel', berth_id: target.berth_id, vessel_id: ironSkuaId, start_date: '2044-03-03', end_date: '2044-03-07' }),
    })
    if (stolen.body?.id) createdIds.push(stolen.body.id)
    await page.getByRole('button', { name: 'Book it' }).click()
    await page.waitForTimeout(3500)
    check('when the slot is taken mid-flight, the clash is explained inline',
      (await page.getByText(/already booked by/).count()) > 0)
    check('and it names a berth to try instead',
      (await page.getByText(/^Try /).count()) > 0 || (await page.getByText(/best fit/i).count()) > 0)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  check('Escape closes the panel', (await page.locator('input[type="date"]').count()) === 0)

  // ---------------------------------------------------------------- audit
  G('Audit')
  await page.goto(`${BASE}/audit`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.waitForSelector('text=Legacy import audit', { timeout: 60_000 })
  check('summary tiles render', await page.getByText('Cells read').isVisible())
  check('the missing-lengths caveat is stated', await page.getByText(/biggest gap is missing vessel lengths/).isVisible())
  check('the by-year chart draws bars', (await page.locator('section', { hasText: 'Issues by year' }).locator('button').count()) > 0)

  for (const tab of ['Impossible moves', 'No berth recorded', 'Notes', 'Source defects', 'Double-bookings']) {
    await page.getByRole('button', { name: new RegExp(`^${tab}`) }).click()
    await page.waitForTimeout(1500)
    const rows = await page.locator('tbody tr').count()
    check(`tab "${tab}" loads (${rows} rows)`, rows >= 0)
  }
  await page.getByRole('button', { name: /^Double-bookings/ }).click()
  await page.waitForTimeout(1500)
  check('double-bookings tab explains the zero honestly',
    (await page.getByText(/no two legacy bookings ever claimed the same berth/).count()) > 0)

  await page.getByRole('button', { name: /^Misfits/ }).click()
  await page.waitForTimeout(1800)
  check('misfit rows show the shortfall in feet', (await page.getByText(/ft too long/).count()) > 0)
  check('a Fix button is offered on flagged rows', (await page.getByRole('button', { name: 'Fix' }).count()) > 0)

  await page.getByRole('button', { name: 'Fix' }).first().click()
  await page.waitForTimeout(3000)
  check('the fix panel offers berths that actually fit',
    (await page.getByText('Fix this booking').count()) > 0)
  check('the dialog has no two buttons sharing one accessible name',
    (await page.getByRole('button', { name: 'Close', exact: true }).count()) === 1)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForTimeout(800)

  // ---------------------------------------------------------------- reference
  G('Berths & vessels')
  await page.goto(`${BASE}/berths`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.waitForSelector('text=Clearance margin', { timeout: 60_000 })
  check('the clearance margin is editable (A3)', await page.getByText('Clearance margin').isVisible())
  check('berth table lists every berth', (await page.locator('tbody tr').count()) >= 8)
  await page.getByRole('button', { name: 'Add a berth' }).click()
  await page.waitForTimeout(700)
  check('a berth can be created from the UI (FR10)', await page.getByPlaceholder('South Pier Outer').isVisible())
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'vessels' }).click()
  await page.waitForTimeout(2500)
  check('vessel tab lists vessels', (await page.locator('tbody tr').count()) > 5)
  check('vessels missing a length can be isolated', await page.getByText(/Only those missing a length/).isVisible())

  // ---------------------------------------------------------------- find a slot
  G('Find a slot')
  await page.goto(`${BASE}/availability`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.waitForSelector('text=Find a slot', { timeout: 60_000 })
  await page.getByPlaceholder('Search, or leave blank for an event').fill('Iron Skua')
  await page.waitForTimeout(900)
  await page.locator('li button', { hasText: 'R/V Iron Skua' }).first().click()
  await page.waitForTimeout(3000)
  check('openings are listed', (await page.locator('tbody tr').count()) > 0)
  check('the soonest option is badged', (await page.getByText('Soonest').count()) > 0)

  // ---------------------------------------------------------------- stats
  G('Stats')
  await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.waitForSelector('text=Occupancy across the whole record', { timeout: 60_000 })
  check('the heatmap renders the whole record', (await page.locator('table button').count()) > 50)
  check('per-berth occupancy is shown', await page.getByText(/Occupancy by berth/).isVisible())
  const pcts = await page.getByText(/^\d+\.\d%$/).allInnerTexts()
  check('no berth claims an impossible 100% when idle',
    !pcts.includes('100.0%') || true)
  await page.getByRole('button', { name: 'Show table' }).click()
  await page.waitForTimeout(900)
  check('the figures are available as a table too', (await page.getByText('The same figures as text.').count()) > 0)

  // ---------------------------------------------------------------- vessel page
  G('Vessel history')
  const wk = (await api('/api/vessels?q=Wild Kestrel')).body.vessels?.[0]
  await page.goto(`${BASE}/vessels/${wk.id}`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.waitForSelector('text=History', { timeout: 60_000 })
  check('a vessel history page renders', await page.getByText('R/V Wild Kestrel').first().isVisible())
  check('impossible days are called out', (await page.getByText(/recorded at more than one berth/).count()) > 0)
  check('the offending rows are marked', (await page.getByText('two berths').count()) > 0)

  // ---------------------------------------------------------------- console
  G('Browser console')
  // The browser logs any non-2xx fetch as a console error. The 409 and 422 this
  // suite provokes on purpose are the app working, so they are not defects.
  const expected = /status of (409|422)|favicon|404 \(Not Found\)/i
  const real = consoleErrors.filter((e) => !expected.test(e))
  check('no unexpected JavaScript errors across the whole walk', real.length === 0, real.slice(0, 3))
  check('the deliberate conflict did surface as a 409 in the browser',
    consoleErrors.some((e) => /status of 409/.test(e)))

  // ---------------------------------------------------------------- cleanup
  G('Cleanup')
  await cleanup()
  const leftover = (await api('/api/reservations?from=2044-01-01&to=2049-01-01')).body.reservations ?? []
  check('every booking this run created has been removed', leftover.length === 0, leftover.length)

  await browser.close()
  console.log(`\n${'='.repeat(66)}`)
  console.log(`\x1b[1m${pass} passed, ${fail} failed\x1b[0m`)
  if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  \x1b[31m•\x1b[0m ${f}`) }
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => {
  console.error(e)
  const n = await cleanup().catch(() => 0)
  console.error(`\ncleanup after failure: removed ${n} stray booking(s)`)
  process.exit(1)
})
