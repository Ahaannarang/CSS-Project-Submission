'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Berth, Reservation, Vessel } from './types'
import { MONTHS, addDays, daysInMonth, diffDays, fmtFull, ft, iso, weekdayOf } from '@/lib/dates'
import BookingPanel from './BookingPanel'

const TODAY = new Date().toISOString().slice(0, 10)

/**
 * What to print inside a timeline bar.
 *
 * Most legacy stays are a single day, which is about 45px wide — only a few
 * characters. Printing the full name there yields "R/V…", "M/V…", "S/V…" for
 * every bar, so the one part that identifies the vessel is the part that gets
 * cut. The designation prefix is dropped for the bar only; the full name stays
 * in the tooltip and everywhere else.
 */
function barLabel(r: Reservation): string {
  const full = r.vessel_name ?? r.title ?? ''
  return full.replace(/^(R\/V|M\/V|M\/Y|S\/V|S\/Y|F\/V|OS\/V|OSV|Tug|Barge)\s+/i, '')
}

/**
 * Berths as rows, days as columns — the grid the coordinator already thinks in.
 *
 * Active bookings can never overlap, but flagged legacy rows can and do, so each
 * berth is packed into as many lanes as it needs rather than hiding the clash.
 * That is the whole point: the old grid could not show two boats in one box.
 */
export default function Timeline({
  initialBerths, initialYear, initialMonth, openBooking = null,
}: {
  initialBerths: Berth[]
  initialYear: number
  initialMonth: number
  /** Set when arriving from "Find a slot", so the panel opens already filled in. */
  openBooking?: { berthId: number | null; vesselId: number | null; start: string; end: string } | null
}) {
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [berths, setBerths] = useState<Berth[]>(initialBerths)
  const [rows, setRows] = useState<Reservation[]>([])
  const [vessels, setVessels] = useState<Vessel[]>([])
  const [loading, setLoading] = useState(true)
  const [loadMs, setLoadMs] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [berthFilter, setBerthFilter] = useState<number | null>(null)
  const [globalHits, setGlobalHits] = useState<Reservation[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [panel, setPanel] = useState<
    | { mode: 'create'; berthId: number | null; vesselId?: number | null; start: string; end: string }
    | { mode: 'edit'; reservation: Reservation }
    | null
  >(
    openBooking
      ? { mode: 'create', berthId: openBooking.berthId, vesselId: openBooking.vesselId, start: openBooking.start, end: openBooking.end }
      : null,
  )

  const nDays = daysInMonth(year, month)
  const monthStart = iso(year, month, 1)
  const monthEnd = iso(year, month, nDays)

  const load = useCallback(async () => {
    setLoading(true)
    const t0 = performance.now()
    const res = await fetch(`/api/reservations?from=${monthStart}&to=${addDays(monthEnd, 1)}`, { cache: 'no-store' })
    const json = await res.json()
    setRows(json.reservations ?? [])
    setLoadMs(Math.round(performance.now() - t0))
    setLoading(false)
  }, [monthStart, monthEnd])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/vessels?with_length=1').then((r) => r.json()).then((j) => setVessels(j.vessels ?? []))
  }, [])

  // Keep the address bar in step, so a month can be linked to from the audit.
  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('y', String(year))
    url.searchParams.set('m', String(month))
    window.history.replaceState(null, '', url)
  }, [year, month])

  const refreshBerths = useCallback(async () => {
    const j = await fetch('/api/berths', { cache: 'no-store' }).then((r) => r.json())
    setBerths(j.berths ?? [])
  }, [])

  // Keyboard: the PRD asks for a form a coordinator can drive without a mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
      if (e.key === 'Escape') { setPanel(null); return }
      if (typing || panel) return
      if (e.key === 'ArrowLeft') { step(-1); e.preventDefault() }
      if (e.key === 'ArrowRight') { step(1); e.preventDefault() }
      if (e.key === 'n' || e.key === 'N') {
        setPanel({ mode: 'create', berthId: null, start: monthStart, end: monthStart })
        e.preventDefault()
      }
      if (e.key === 't' || e.key === 'T') {
        const now = new Date()
        setYear(now.getUTCFullYear()); setMonth(now.getUTCMonth() + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const step = (delta: number) => {
    let m = month + delta, y = year
    while (m < 1) { m += 12; y -= 1 }
    while (m > 12) { m -= 12; y += 1 }
    setYear(y); setMonth(m)
  }

  const filtered = useMemo(() => {
    let out = rows
    if (berthFilter != null) out = out.filter((r) => r.berth_id === berthFilter)
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      out = out.filter((r) =>
        (r.vessel_name ?? '').toLowerCase().includes(needle) ||
        (r.title ?? '').toLowerCase().includes(needle) ||
        r.berth_name.toLowerCase().includes(needle))
    }
    return out
  }, [rows, q, berthFilter])

  // A month view answers "who is here now". Searching a vessel usually means
  // "where has it ever been", so the same box also searches the whole record
  // and offers to jump to whichever month a match is in (FR13).
  useEffect(() => {
    const needle = q.trim()
    if (needle.length < 2) { setGlobalHits(null); return }
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setSearching(true)
      const p = new URLSearchParams({ from: '1900-01-01', to: '2100-01-01', q: needle })
      if (berthFilter != null) p.set('berth', String(berthFilter))
      fetch(`/api/reservations?${p}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((j) => setGlobalHits(j.reservations ?? []))
        .catch(() => {})
        .finally(() => setSearching(false))
    }, 250)
    return () => { clearTimeout(t); ctl.abort() }
  }, [q, berthFilter])

  // Pack each berth's bookings into lanes so overlaps stay visible.
  const lanesByBerth = useMemo(() => {
    const map = new Map<number, Reservation[][]>()
    for (const b of berths) map.set(b.id, [])
    for (const r of [...filtered].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id - b.id)) {
      const lanes = map.get(r.berth_id)
      if (!lanes) continue
      let placed = false
      for (const lane of lanes) {
        if (lane[lane.length - 1].end_date < r.start_date) { lane.push(r); placed = true; break }
      }
      if (!placed) lanes.push([r])
    }
    return map
  }, [filtered, berths])

  const flaggedCount = filtered.filter((r) => r.status === 'flagged').length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1">
          <button onClick={() => step(-1)} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100" aria-label="Previous month">←</button>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded px-1 py-1 text-sm font-medium outline-none">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="w-20 rounded px-1 py-1 text-sm font-medium outline-none" />
          <button onClick={() => step(1)} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100" aria-label="Next month">→</button>
        </div>

        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any vessel, event or berth"
          className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-chart" />

        <select value={berthFilter ?? ''} onChange={(e) => setBerthFilter(e.target.value ? Number(e.target.value) : null)}
          className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
          <option value="">All berths</option>
          {berths.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <button
          onClick={() => setPanel({ mode: 'create', berthId: null, start: monthStart, end: monthStart })}
          className="rounded-lg bg-chart px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
          New booking
        </button>

        <a href={`/api/export?from=${monthStart}&to=${addDays(monthEnd, 1)}`}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          Export CSV
        </a>

        <div className="ml-auto flex items-center gap-3 text-xs text-slate-600">
          <Legend className="bg-chart" label="Vessel" />
          <Legend className="bg-chart-2" label="Event" />
          <Legend className="bg-flag" label="Flagged" />
          {loadMs != null && <span className="tabular-nums text-slate-400">{filtered.length} bookings · {loadMs} ms</span>}
          <span className="hidden text-slate-400 lg:inline">← → month · N new · T today</span>
        </div>
      </div>

      {flaggedCount > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {flaggedCount} flagged booking{flaggedCount === 1 ? '' : 's'} this month — imported history that breaks a rule.{' '}
          <a href="/audit" className="font-medium underline">Open the audit</a>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
        <div className="min-w-[900px]">
          {/* day header */}
          <div className="grid border-b border-slate-200 bg-slate-50"
            style={{ gridTemplateColumns: `210px repeat(${nDays}, minmax(22px, 1fr))` }}>
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Berth</div>
            {Array.from({ length: nDays }, (_, i) => {
              const d = iso(year, month, i + 1)
              const wd = weekdayOf(d)
              const weekend = wd === 0 || wd === 6
              return (
                <div key={d} className={`border-l py-1 text-center text-[10px] leading-tight ${
                  d === TODAY ? 'border-l-2 border-chart bg-blue-50' : 'border-slate-200'} ${weekend && d !== TODAY ? 'bg-slate-100' : ''}`}>
                  <div className="text-slate-400">{'SMTWTFS'[wd]}</div>
                  <div className={`tabular-nums ${d === TODAY ? 'font-bold text-chart' : 'text-slate-600'}`}>{i + 1}</div>
                </div>
              )
            })}
          </div>

          {berths.map((b) => {
            const lanes = lanesByBerth.get(b.id) ?? []
            const laneCount = Math.max(1, lanes.length)
            return (
              <div key={b.id} className="relative border-b border-slate-200 last:border-b-0">
                <div className="grid" style={{ gridTemplateColumns: `210px repeat(${nDays}, minmax(22px, 1fr))` }}>
                  <div className="flex flex-col justify-center px-3 py-2">
                    <div className="truncate text-sm font-medium text-slate-800">{b.name}</div>
                    <div className="text-xs text-slate-500">{b.length_ft ? ft(b.length_ft) : 'length unknown'}</div>
                  </div>
                  {/* click-to-book cells */}
                  {Array.from({ length: nDays }, (_, i) => {
                    const d = iso(year, month, i + 1)
                    const wd = weekdayOf(d)
                    return (
                      <button key={d}
                        onClick={() => setPanel({ mode: 'create', berthId: b.id, start: d, end: d })}
                        title={`Book ${b.name} on ${fmtFull(d)}`}
                        className={`border-l transition hover:bg-blue-50 ${
                          d === TODAY ? 'border-l-2 border-chart' : 'border-slate-100'} ${
                          wd === 0 || wd === 6 ? 'bg-slate-50/70' : ''}`}
                        style={{ minHeight: laneCount * 26 + 12 }} />
                    )
                  })}
                </div>

                {/* bars, laid over the cells */}
                <div className="pointer-events-none absolute inset-0 grid"
                  style={{ gridTemplateColumns: `210px repeat(${nDays}, minmax(22px, 1fr))` }}>
                  <div />
                  {lanes.map((lane, li) =>
                    lane.map((r) => {
                      const from = r.start_date < monthStart ? monthStart : r.start_date
                      const to = r.end_date > monthEnd ? monthEnd : r.end_date
                      const startCol = diffDays(monthStart, from) + 2
                      const span = Math.max(1, diffDays(from, to) + 1)
                      const clippedLeft = r.start_date < monthStart
                      const clippedRight = r.end_date > monthEnd
                      const colour =
                        r.status === 'flagged' ? 'bg-flag text-white'
                          : r.kind === 'event' ? 'bg-chart-2 text-white'
                            : 'bg-chart text-white'
                      return (
                        <button key={r.id}
                          onClick={() => setPanel({ mode: 'edit', reservation: r })}
                          className={`tl-bar pointer-events-auto mx-[1px] truncate px-1 text-left text-[10px] font-medium leading-[22px] tracking-tight ${colour} ${clippedLeft ? 'rounded-l-none' : 'rounded-l'} ${clippedRight ? 'rounded-r-none' : 'rounded-r'} hover:brightness-110`}
                          style={{ gridColumn: `${startCol} / span ${span}`, gridRow: 1, marginTop: li * 26 + 6, height: 22 }}
                          title={`${r.vessel_name ?? r.title} · ${b.name} · ${fmtFull(r.start_date)} – ${fmtFull(r.end_date)}${r.status === 'flagged' ? ' · FLAGGED' : ''}`}>
                          {clippedLeft ? '‹' : ''}{barLabel(r)}{clippedRight ? '›' : ''}
                        </button>
                      )
                    }),
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {globalHits && (
        <div className="rounded-xl border border-slate-300 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <p className="text-sm font-medium">
              {searching ? 'Searching the whole record…' : `${globalHits.length} match${globalHits.length === 1 ? '' : 'es'} across 1997–today`}
            </p>
            <button onClick={() => { setQ(''); setGlobalHits(null) }}
              className="text-xs text-slate-500 hover:text-slate-900 hover:underline">Clear</button>
          </div>
          <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto">
            {globalHits.slice(0, 200).map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => {
                    setYear(Number(r.start_date.slice(0, 4)))
                    setMonth(Number(r.start_date.slice(5, 7)))
                  }}
                  className="flex w-full items-baseline justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                  <span>
                    <span className={`mr-2 inline-block h-2 w-2 rounded-full ${
                      r.status === 'flagged' ? 'bg-flag' : r.kind === 'event' ? 'bg-chart-2' : 'bg-chart'}`} />
                    <span className="font-medium">{r.vessel_name ?? r.title}</span>
                    <span className="ml-2 text-xs text-slate-500">{r.berth_name}</span>
                  </span>
                  <span className="text-xs tabular-nums text-slate-500">
                    {fmtFull(r.start_date)}{r.days > 1 ? ` – ${fmtFull(r.end_date)}` : ''}
                  </span>
                </button>
              </li>
            ))}
            {globalHits.length === 0 && !searching && (
              <li className="px-3 py-4 text-center text-sm text-slate-500">Nothing matches “{q}”.</li>
            )}
          </ul>
        </div>
      )}

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && filtered.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
          Nothing booked in {MONTHS[month - 1]} {year}. Click any cell to make a booking.
        </p>
      )}

      {panel && (
        <BookingPanel
          key={panel.mode === 'edit' ? `e${panel.reservation.id}` : `c${panel.berthId}${panel.start}`}
          state={panel}
          berths={berths}
          vessels={vessels}
          onClose={() => setPanel(null)}
          onSaved={() => { setPanel(null); load(); refreshBerths() }}
        />
      )}
    </div>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-4 rounded-sm ${className}`} />
      {label}
    </span>
  )
}
