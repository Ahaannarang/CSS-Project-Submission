/**
 * Captures the three screenshots the README leads with, from the live site.
 *
 * Scripted rather than hand-taken so they can be regenerated after a UI change
 * and always show the same scenario: the timeline on its busiest month, a
 * booking mid-flight with live berth suggestions, and the audit's misfit list.
 *
 *   npx tsx scripts/screenshots.mts [baseUrl]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'https://css-project-submission.vercel.app'
const OUT = 'docs'

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,          // retina, so the text stays crisp on GitHub
  })

  // ---------------------------------------------------------------- timeline
  console.log('1/4 timeline …')
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 90_000 })
  // Wait for actual booking bars, not the berth name — that also matches an
  // <option> in the filter dropdown, which is present before any data loads.
  await page.waitForSelector('.tl-bar', { timeout: 60_000 })
  await page.waitForTimeout(1500)                 // let the bars finish painting
  await page.screenshot({ path: `${OUT}/timeline.png` })

  // ------------------------------------------------- booking with suggestions
  console.log('2/4 booking panel …')
  await page.getByRole('button', { name: 'New booking' }).click()
  await page.waitForSelector('text=Vessel', { timeout: 30_000 })

  const search = page.getByPlaceholder('Search vessels with a known length')
  await search.fill('Iron Skua')
  await page.waitForTimeout(700)
  await page.locator('li button', { hasText: 'R/V Iron Skua' }).first().click()

  const dates = page.locator('input[type="date"]')
  await dates.nth(0).fill('2029-06-01')
  await dates.nth(1).fill('2029-06-05')

  // wait for the ranked berths to come back
  await page.waitForSelector('text=Best fit', { timeout: 45_000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/booking.png` })

  // ---------------------------------------------------------------- audit
  console.log('3/4 audit …')
  await page.keyboard.press('Escape')
  await page.goto(`${BASE}/audit`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.waitForSelector('text=Legacy import audit', { timeout: 60_000 })
  await page.waitForSelector('text=Issues by year', { timeout: 60_000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/audit.png` })

  // ---------------------------------------------------------------- stats
  console.log('4/4 stats …')
  await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.waitForSelector('text=Occupancy across the whole record', { timeout: 60_000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/stats.png` })

  await browser.close()
  console.log('done ->', OUT)
}

main().catch((e) => { console.error(e); process.exit(1) })
