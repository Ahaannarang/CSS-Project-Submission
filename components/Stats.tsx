'use client'

import { useCallback, useEffect, useState } from 'react'
import { MONTHS } from '@/lib/dates'

/**
 * FR12: utilisation.
 *
 * Both charts show one series of magnitudes, so they use a single blue hue
 * rather than a categorical palette — the bar length already carries the value,
 * and a second colour would encode nothing. Every bar is directly labelled and
 * the same numbers are repeated in a table below, so nothing depends on colour.
 */
const BAR = '#2a78d6'

/**
 * Sequential blue, light -> dark, for the 23-year heatmap. Magnitude is the job,
 * so it is one hue with more meaning darker; a rainbow here would imply the
 * months were different kinds of thing rather than different amounts of the same
 * thing. The lightest step is allowed to recede toward the surface because it
 * means "near zero"; "no data at all" is a neutral gray, deliberately outside
 * the ramp so an empty month cannot be misread as a quiet one.
 */
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#104281']
const NO_DATA = '#eceef1'

/** Text must stay readable once the fill gets dark. */
const inkOn = (step: number) => (step >= 3 ? '#ffffff' : '#0f172a')

type Data = {
  year: number
  per_berth: { id: number; name: string; length_ft: string | null; occupied_days: number; window_days: number }[]
  per_month: { month: number; occupied_days: number; capacity_days: number }[]
  busiest_months: { month: number; berth_days: number }[]
  span: { first_day: string; last_day: string; total: number; flagged: number }
}

export default function Stats({ initialYear, years }: { initialYear: number; years: number[] }) {
  const [year, setYear] = useState(initialYear)
  const [data, setData] = useState<Data | null>(null)
  const [showTable, setShowTable] = useState(false)
  const [heat, setHeat] = useState<{ grid: any[]; berth_count: number } | null>(null)

  useEffect(() => {
    fetch('/api/stats?span=all', { cache: 'no-store' }).then((r) => r.json()).then(setHeat)
  }, [])

  const load = useCallback(async () => {
    const j = await fetch(`/api/stats?year=${year}`, { cache: 'no-store' }).then((r) => r.json())
    setData(j)
  }, [year])
  useEffect(() => { load() }, [load])

  if (!data) return <p className="text-sm text-slate-500">Loading…</p>

  const berthPct = data.per_berth.map((b) => ({
    ...b,
    pct: b.window_days ? (100 * b.occupied_days) / b.window_days : 0,
  }))
  const monthPct = data.per_month.map((m) => ({
    ...m,
    pct: m.capacity_days ? (100 * m.occupied_days) / m.capacity_days : 0,
  }))
  const overall =
    berthPct.length
      ? berthPct.reduce((s, b) => s + b.occupied_days, 0) / berthPct.reduce((s, b) => s + b.window_days, 0) * 100
      : 0
  const maxMonth = Math.max(1, ...monthPct.map((m) => m.pct))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Utilisation</h1>
          <p className="mt-1 text-sm text-slate-600">
            How much of each berth was occupied, measured in berth-days. Stays that cross a boundary are
            clipped to the window, so the figures add up.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => setShowTable((s) => !s)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            {showTable ? 'Hide table' : 'Show table'}
          </button>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-300 bg-white px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Occupancy in {year}</div>
          <div className="mt-1 text-5xl font-semibold tabular-nums text-slate-900">{overall.toFixed(1)}<span className="text-2xl text-slate-400">%</span></div>
          <p className="mt-2 text-sm text-slate-600">
            across {data.per_berth.length} berths, all days of the year.
          </p>
        </div>
        <div className="rounded-xl border border-slate-300 bg-white px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Busiest months, all years</div>
          <ul className="mt-2 space-y-1 text-sm">
            {data.busiest_months.map((m, i) => (
              <li key={m.month} className="flex items-baseline justify-between">
                <span className={i === 0 ? 'font-medium' : 'text-slate-600'}>{MONTHS[m.month - 1]}</span>
                <span className="tabular-nums text-slate-500">{m.berth_days.toLocaleString()} berth-days</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-300 bg-white px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Whole record</div>
          <p className="mt-2 text-sm text-slate-700">
            <span className="font-medium tabular-nums">{data.span?.total?.toLocaleString()}</span> bookings from{' '}
            {data.span?.first_day} to {data.span?.last_day},{' '}
            <span className="font-medium tabular-nums">{data.span?.flagged}</span> of them flagged.
          </p>
        </div>
      </section>

      {/* Occupancy by berth — horizontal bars, one series, directly labelled. */}
      <section className="rounded-xl border border-slate-300 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold">Occupancy by berth, {year}</h2>
        <div className="mt-4 space-y-2.5">
          {berthPct.map((b) => (
            <div key={b.id} className="group grid grid-cols-[150px_1fr_86px] items-center gap-3"
              title={`${b.name}: ${b.occupied_days} of ${b.window_days} days`}>
              <div className="truncate text-sm text-slate-700">
                {b.name}
                <span className="ml-1 text-xs text-slate-400">{b.length_ft ? `${Number(b.length_ft)}′` : '—'}</span>
              </div>
              <div className="h-5 rounded-sm bg-slate-100">
                <div className="h-5 rounded-r-[4px] transition-[filter] group-hover:brightness-110"
                  style={{ width: `${Math.max(b.pct, 0.4)}%`, background: BAR }} />
              </div>
              <div className="text-right text-sm tabular-nums text-slate-700">
                {b.pct.toFixed(1)}%
                <span className="ml-1 text-xs text-slate-400">{b.occupied_days}d</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Occupancy by month — columns over time, same single hue. */}
      <section className="rounded-xl border border-slate-300 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold">Occupancy by month, {year}</h2>
        <div className="mt-5 flex h-48 items-end gap-2">
          {monthPct.map((m) => (
            <div key={m.month} className="group flex flex-1 flex-col items-center justify-end gap-1.5"
              title={`${MONTHS[m.month - 1]}: ${m.pct.toFixed(1)}% (${m.occupied_days} berth-days)`}>
              <span className="text-[11px] tabular-nums text-slate-500 opacity-0 transition group-hover:opacity-100">
                {m.pct.toFixed(0)}%
              </span>
              <div className="w-full rounded-t-[4px] transition-[filter] group-hover:brightness-110"
                style={{ height: `${Math.max((m.pct / maxMonth) * 100, 1)}%`, background: BAR, minHeight: 2 }} />
              <span className="text-[11px] text-slate-500">{MONTHS[m.month - 1].slice(0, 3)}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Percentage of all berth-days available that month. Hover a column for the exact figure.
        </p>
      </section>

      {/* The whole record at once — the one view a month-by-month grid cannot give. */}
      {heat && <Heatmap heat={heat} onPick={(y) => setYear(y)} />}

      {showTable && (
        <section className="overflow-hidden rounded-xl border border-slate-300 bg-white">
          <table className="w-full text-sm">
            <caption className="px-3 pt-3 text-left text-xs text-slate-500">The same figures as text.</caption>
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2 font-semibold">Berth</th><th className="px-3 py-2 font-semibold">Length</th>
                <th className="px-3 py-2 font-semibold">Occupied days</th><th className="px-3 py-2 font-semibold">Occupancy</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {berthPct.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2">{b.name}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{b.length_ft ? `${Number(b.length_ft)} ft` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{b.occupied_days} / {b.window_days}</td>
                  <td className="px-3 py-2 tabular-nums">{b.pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}


function Heatmap({ heat, onPick }: { heat: { grid: any[]; berth_count: number }; onPick: (y: number) => void }) {
  const byCell = new Map<string, number>()
  let maxPct = 0
  const years = new Set<number>()

  for (const row of heat.grid) {
    const daysInMonth = new Date(Date.UTC(row.year, row.month, 0)).getUTCDate()
    const capacity = daysInMonth * heat.berth_count
    const pct = capacity ? (100 * row.berth_days) / capacity : 0
    byCell.set(`${row.year}-${row.month}`, pct)
    if (pct > maxPct) maxPct = pct
    years.add(row.year)
  }
  const yearList = [...years].sort()
  if (!yearList.length) return null

  // Six equal bands up to the busiest month, so the darkest cell is the peak.
  const stepOf = (pct: number) => Math.min(RAMP.length - 1, Math.floor((pct / (maxPct || 1)) * RAMP.length))

  return (
    <section className="rounded-xl border border-slate-300 bg-white px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Occupancy across the whole record</h2>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>quieter</span>
          <span className="inline-flex overflow-hidden rounded-sm">
            {RAMP.map((c) => <span key={c} className="h-3 w-5" style={{ background: c }} />)}
          </span>
          <span>busier ({maxPct.toFixed(0)}%)</span>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="pr-2 text-right text-[11px] font-medium text-slate-500"></th>
              {MONTHS.map((m) => (
                <th key={m} className="px-1 text-[11px] font-medium text-slate-500">{m.slice(0, 1)}</th>
              ))}
              <th className="pl-2 text-[11px] font-medium text-slate-500">year</th>
            </tr>
          </thead>
          <tbody>
            {yearList.map((y) => {
              const yearTotal = MONTHS.reduce((sum, _, i) => sum + (byCell.get(`${y}-${i + 1}`) ?? 0), 0) / 12
              return (
                <tr key={y}>
                  <th className="pr-2 text-right text-[11px] font-medium tabular-nums text-slate-500">{y}</th>
                  {MONTHS.map((m, i) => {
                    const pct = byCell.get(`${y}-${i + 1}`)
                    const step = pct == null ? -1 : stepOf(pct)
                    return (
                      <td key={m}>
                        <button
                          onClick={() => onPick(y)}
                          title={`${m} ${y}: ${pct == null ? 'nothing booked' : pct.toFixed(1) + '% occupied'}`}
                          className="h-5 w-7 rounded-[3px] text-[9px] font-medium tabular-nums transition hover:ring-2 hover:ring-slate-900/30"
                          style={{
                            background: step < 0 ? NO_DATA : RAMP[step],
                            color: step < 0 ? '#94a3b8' : inkOn(step),
                          }}>
                          {pct != null && pct >= maxPct * 0.8 ? pct.toFixed(0) : ''}
                        </button>
                      </td>
                    )
                  })}
                  <td className="pl-2 text-[11px] tabular-nums text-slate-500">{yearTotal.toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Each cell is one month's occupancy across all berths; the busiest months carry their figure.
        Grey means nothing was booked at all. Click a row to open that year above.
      </p>
    </section>
  )
}
