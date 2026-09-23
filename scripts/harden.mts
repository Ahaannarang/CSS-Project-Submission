/**
 * Adversarial pass over the live API.
 *
 * The end-to-end suite walks the happy paths for each requirement. This one
 * tries to break things: odd calendars, hostile strings, wrong types, absurd
 * ranges, and two clients racing for the same berth. Anything that returns a
 * 500, corrupts data, or silently accepts nonsense is a bug.
 *
 *   npx tsx scripts/harden.mts [baseUrl]
 */
const BASE = process.argv[2] ?? 'http://localhost:3100'

let pass = 0, fail = 0
const failures: string[] = []
let group = ''
const G = (n: string) => { group = n; console.log(`\n\x1b[1m${n}\x1b[0m`) }
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`) }
  else {
    fail++; failures.push(`${group} → ${label}`)
    console.log(`  \x1b[31m✗\x1b[0m ${label}`)
    if (detail !== undefined) console.log(`      got: ${JSON.stringify(detail).slice(0, 300)}`)
  }
}
const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  const text = await res.text()
  let body: any = text
  try { body = JSON.parse(text) } catch {}
  return { status: res.status, body, text }
}
/** Any 5xx is a failure: the API should reject bad input, never fall over. */
const noServerError = (s: number) => s < 500

const created: number[] = []

async function main() {
  console.log(`Hardening ${BASE}\n${'='.repeat(64)}`)

  const berths = (await api('/api/berths')).body.berths
  const big = berths.find((b: any) => b.name === 'North Pier West')
  const face = berths.find((b: any) => b.name === 'North Pier Face')
  const unlengthed = berths.find((b: any) => b.length_ft == null)
  const v = (await api('/api/vessels?with_length=1&q=Iron Skua')).body.vessels[0]

  const book = (o: any) => api('/api/reservations', { method: 'POST', body: JSON.stringify(o) })
  const vessel = (over: any = {}) => ({
    kind: 'vessel', berth_id: big.id, vessel_id: v.id,
    start_date: '2035-01-01', end_date: '2035-01-02', ...over,
  })

  // ---------------------------------------------------------------- calendars
  G('Awkward calendars')
  let r = await book(vessel({ start_date: '2036-02-29', end_date: '2036-02-29' }))   // 2036 is a leap year
  check('accepts 29 Feb in a leap year', r.status === 201, r.body); if (r.body?.id) created.push(r.body.id)

  r = await book(vessel({ start_date: '2035-02-29', end_date: '2035-03-01' }))       // 2035 is not
  check('rejects 29 Feb in a non-leap year', r.status === 400 && noServerError(r.status), r.body)

  r = await book(vessel({ berth_id: face.id, start_date: '2035-12-30', end_date: '2036-01-02' }))
  check('a stay may cross a year boundary', r.status === 201, r.body)
  if (r.body?.id) {
    created.push(r.body.id)
    const inDec = await api('/api/reservations?from=2035-12-01&to=2036-01-01')
    const inJan = await api('/api/reservations?from=2036-01-01&to=2036-02-01')
    const id = r.body.id
    check('it shows in both months, not just one',
      inDec.body.reservations.some((x: any) => x.id === id) && inJan.body.reservations.some((x: any) => x.id === id))
  }

  r = await book(vessel({ berth_id: face.id, start_date: '2040-01-01', end_date: '2043-12-31' }))
  check('accepts a multi-year stay', r.status === 201, r.body); if (r.body?.id) created.push(r.body.id)

  r = await book(vessel({ start_date: '2035-06-15', end_date: '2035-06-15' }))
  check('accepts a single-day stay', r.status === 201, r.body); if (r.body?.id) created.push(r.body.id)

  for (const bad of ['2035-13-01', '2035-00-10', '2035-01-32', '35-01-01', '2035/01/01', 'tomorrow', '']) {
    const res = await book(vessel({ start_date: bad, end_date: '2035-01-05' }))
    check(`rejects malformed date ${JSON.stringify(bad)}`, res.status === 400 && noServerError(res.status), res.status)
  }

  // ---------------------------------------------------------------- hostile strings
  G('Hostile input')
  const nasty: [string, string][] = [
    ["SQL in an event title", "Robert'); DROP TABLE reservations;--"],
    ["a quote storm", `"''""--/**/`],
    ["script tag", '<script>alert(1)</script>'],
    ["unicode + emoji", '⚓ Régate d’été 🚢 日本語'],
    ["newlines", 'line one\nline two\ttabbed'],
  ]
  for (const [label, title] of nasty) {
    const res = await api('/api/reservations', {
      method: 'POST',
      body: JSON.stringify({ kind: 'event', berth_id: unlengthed.id, title, start_date: '2037-03-01', end_date: '2037-03-02' }),
    })
    check(`stores ${label} safely`, res.status === 201, res.body)
    if (res.body?.id) {
      created.push(res.body.id)
      const back = await api('/api/reservations?from=2037-03-01&to=2037-03-03')
      const got = back.body.reservations.find((x: any) => x.id === res.body.id)
      check(`  ${label} round-trips unchanged`, got?.title === title, got?.title)
      await api(`/api/reservations/${res.body.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
    }
  }
  const stillThere = await api('/api/berths')
  check('the tables still exist after the injection attempts', stillThere.body.berths?.length === berths.length)

  const longTitle = 'x'.repeat(5000)
  r = await api('/api/reservations', {
    method: 'POST',
    body: JSON.stringify({ kind: 'event', berth_id: unlengthed.id, title: longTitle, start_date: '2037-04-01', end_date: '2037-04-02' }),
  })
  check('rejects an absurdly long title rather than truncating', r.status === 400 && noServerError(r.status), r.status)

  for (const q of ["'; DROP TABLE vessels;--", '%', '_', '100%', '\\']) {
    const res = await api(`/api/reservations?from=1997-01-01&to=2040-01-01&q=${encodeURIComponent(q)}`)
    check(`search survives ${JSON.stringify(q)}`, res.status === 200 && Array.isArray(res.body.reservations), res.status)
  }

  // ---------------------------------------------------------------- bad types / ids
  G('Wrong types and bad identifiers')
  const badBodies: [string, any][] = [
    ['missing everything', {}],
    ['berth_id as text', { ...vessel(), berth_id: 'abc' }],
    ['berth_id null', { ...vessel(), berth_id: null }],
    ['negative berth_id', { ...vessel(), berth_id: -1 }],
    ['zero berth_id', { ...vessel(), berth_id: 0 }],
    ['float berth_id', { ...vessel(), berth_id: 1.5 }],
    ['huge berth_id', { ...vessel(), berth_id: 9_999_999_999 }],
    ['unknown kind', { ...vessel(), kind: 'submarine' }],
    ['array where object', []],
    ['vessel booking with no vessel', { kind: 'vessel', berth_id: 1, start_date: '2035-05-01', end_date: '2035-05-02' }],
    ['event carrying a vessel_id', { kind: 'event', berth_id: 1, vessel_id: 1, title: 'x', start_date: '2035-05-01', end_date: '2035-05-02' }],
  ]
  for (const [label, body] of badBodies) {
    const res = await api('/api/reservations', { method: 'POST', body: JSON.stringify(body) })
    check(`${label} → 4xx, never 5xx`, res.status >= 400 && res.status < 500, res.status)
  }
  const malformed = await fetch(BASE + '/api/reservations', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json',
  })
  check('malformed JSON → 4xx', malformed.status >= 400 && malformed.status < 500, malformed.status)

  for (const p of ['/api/reservations/abc', '/api/reservations/-5', '/api/reservations/99999999', '/api/vessels/abc', '/api/vessels/99999999']) {
    const res = await api(p, { method: p.includes('vessels') ? 'GET' : 'PATCH', body: p.includes('vessels') ? undefined : JSON.stringify({ status: 'cancelled' }) })
    check(`${p} → 4xx, never 5xx`, res.status >= 400 && res.status < 500, res.status)
  }

  // ---------------------------------------------------------------- absurd queries
  G('Absurd but legal queries')
  r = await api('/api/reservations?from=1800-01-01&to=2200-01-01')
  check('a 400-year window returns without error', r.status === 200, r.status)
  r = await api('/api/reservations?from=2035-01-01&to=2030-01-01')
  check('an inverted window returns empty, not an error', r.status === 200 && r.body.reservations.length === 0, r.body?.reservations?.length)
  r = await api('/api/suggest?vessel=99999999&start=2035-01-01&end=2035-01-02')
  check('suggest with an unknown vessel does not crash', r.status === 200, r.status)
  r = await api('/api/availability?from=2035-01-01&days=100000')
  check('availability clamps an absurd stay length', r.status === 200, r.status)
  r = await api('/api/stats?year=99999')
  check('stats with a nonsense year does not crash', r.status < 500, r.status)
  r = await api('/api/audit?kind=not_a_kind')
  check('audit with an unknown kind does not crash', r.status < 500, r.status)
  r = await api('/api/audit?year=abc')
  check('audit with a non-numeric year does not crash', r.status < 500, r.status)

  // ---------------------------------------------------------------- the race
  G('Two clients racing for one berth')
  const slot = { kind: 'vessel', berth_id: face.id, vessel_id: v.id, start_date: '2038-08-01', end_date: '2038-08-07' }
  const results = await Promise.all(Array.from({ length: 8 }, () => book(slot)))
  const ok = results.filter((x) => x.status === 201)
  const refused = results.filter((x) => x.status === 409)
  for (const x of ok) if (x.body?.id) created.push(x.body.id)
  check('exactly one of eight concurrent bookings wins', ok.length === 1, { created: ok.length, refused: refused.length })
  check('the other seven get a clean 409', refused.length === 7, refused.length)
  check('none of them 500s', results.every((x) => x.status < 500), results.map((x) => x.status))
  const after = await api('/api/reservations?from=2038-08-01&to=2038-08-08')
  const onBerth = after.body.reservations.filter((x: any) => x.berth_id === face.id && x.status === 'active')
  check('the database holds exactly one booking for that slot', onBerth.length === 1, onBerth.length)

  // ---------------------------------------------------------------- lifecycle
  G('Lifecycle edges')
  const lc = await book(vessel({ berth_id: face.id, start_date: '2039-02-01', end_date: '2039-02-05' }))
  const lcId = lc.body.id
  await api(`/api/reservations/${lcId}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
  const rebook = await book(vessel({ berth_id: face.id, start_date: '2039-02-01', end_date: '2039-02-05' }))
  check('a cancelled slot can be rebooked', rebook.status === 201, rebook.body)
  if (rebook.body?.id) created.push(rebook.body.id)
  const reviveConflict = await api(`/api/reservations/${lcId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) })
  check('reviving a cancelled booking into an occupied slot is refused', reviveConflict.status === 409, reviveConflict.status)
  const doubleCancel = await api(`/api/reservations/${lcId}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
  check('cancelling twice is harmless', doubleCancel.status === 200, doubleCancel.status)

  // ---------------------------------------------------------------- cleanup
  G('Cleanup')
  for (const id of created) {
    await api(`/api/reservations/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })
  }
  check(`${created.length} test bookings cancelled`, true)

  console.log(`\n${'='.repeat(64)}`)
  console.log(`\x1b[1m${pass} passed, ${fail} failed\x1b[0m`)
  if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  \x1b[31m•\x1b[0m ${f}`) }
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
