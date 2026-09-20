'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtFull, ft } from '@/lib/dates'
import type { Berth } from './types'
import FixPanel from './FixPanel'

type Issue = {
  id: number
  kind: string
  year: number | null
  detail: any
  resolved: boolean
  reservation_id: number | null
  berth_name: string | null
  start_date: string | null
  end_date: string | null
  vessel_name: string | null
  vessel_length_ft: string | null
  reservation_status: string | null
}

const TABS = [
  { key: 'overlap', label: 'Double-bookings', blurb: 'Two bookings claiming one berth at the same time.' },
  { key: 'misfit', label: 'Misfits', blurb: 'A vessel assigned to a berth shorter than the vessel.' },
  { key: 'vessel_conflict', label: 'Impossible moves', blurb: 'The same vessel recorded at two berths on one day.' },
  { key: 'unknown_berth', label: 'No berth recorded', blurb: 'Entries written below the berth rows, so the berth is lost.' },
  { key: 'unknown_vessel', label: 'No length on file', blurb: 'Vessels whose length is missing or contradictory, so fit cannot be checked.' },
  { key: 'annotation', label: 'Notes', blurb: 'Operational notes that share a cell with bookings but do not occupy a berth.' },
  { key: 'parse_error', label: 'Source defects', blurb: 'Entries with no usable date, and headers that contradict the calendar: 112 cells sat in a column outside the month, 84 weekday headers disagree with the real weekday, 2 blocks carry the wrong year, and 2 cells sit outside any month block.' },
]

export default function Audit({ berths }: { berths: Berth[] }) {
  const [tab, setTab] = useState('misfit')
  const [year, setYear] = useState('')
  const [berth, setBerth] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [fixing, setFixing] = useState<any>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ kind: tab, limit: '300' })
    if (year) p.set('year', year)
    if (berth) p.set('berth', berth)
    if (showResolved) p.set('resolved', '1')
    const j = await fetch(`/api/audit?${p}`, { cache: 'no-store' }).then((r) => r.json())
    setData(j); setLoading(false)
  }, [tab, year, berth, showResolved])

  useEffect(() => { load() }, [load])

  const counts: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of data?.counts ?? []) m[c.kind] = c.n
    return m
  }, [data])

  const stats = data?.run?.stats ?? {}
  const years = useMemo(() => {
    const s = new Set<number>()
    for (const r of data?.by_year ?? []) s.add(r.year)
    return [...s].sort()
  }, [data])

  const resolve = async (id: number, resolved: boolean) => {
    await fetch(`/api/issues/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolved }),
    })
    load()
  }

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-xl font-semibold">Legacy import audit</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          What 23 years of the hand-kept schedule looks like once every booking is checked against the two
          rules. Nothing was dropped: each source cell is either a booking or listed here.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Cells read" value={stats.cells_read} />
        <Stat label="Bookings built" value={stats.stays_built} />
        <Stat label="Imported clean" value={stats.imported_active} tone="good" />
        <Stat label="Misfits" value={stats.flagged_misfit} tone="bad" />
        <Stat label="Double-bookings" value={stats.flagged_overlap} tone={stats.flagged_overlap ? 'bad' : 'good'} />
        <Stat label="Listed for review" value={(stats.unknown_berth ?? 0) + (stats.unknown_vessel ?? 0) + (stats.vessel_conflicts ?? 0)} tone="warn" />
      </section>

      {stats.stays_fit_checkable != null && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">The biggest gap is missing vessel lengths.</span>{' '}
          Only {stats.stays_fit_checkable} of {stats.stays_built} bookings involve a vessel whose length is on
          file, so the fit rule could be applied to {((100 * stats.stays_fit_checkable) / stats.stays_built).toFixed(1)}%
          of the history. {stats.unknown_vessel} vessels appear in the schedule with no length recorded anywhere
          in the workbook.
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.key ? 'border-chart text-chart' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t.label}
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-600">
              {counts[t.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-600">{TABS.find((t) => t.key === tab)?.blurb}</p>
        <div className="ml-auto flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={berth} onChange={(e) => setBerth(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
            <option value="">All berths</option>
            {berths.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Include resolved
          </label>
          <a href="/api/export?what=issues"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Export CSV
          </a>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Year</th>
              <th className="px-3 py-2 font-semibold">What</th>
              <th className="px-3 py-2 font-semibold">Where</th>
              <th className="px-3 py-2 font-semibold">Detail</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data?.issues ?? []).map((i: Issue) => (
              <tr key={i.id} className={i.resolved ? 'opacity-50' : ''}>
                <td className="px-3 py-2 tabular-nums text-slate-500">{i.year ?? '—'}</td>
                <td className="px-3 py-2">{describe(i)}</td>
                <td className="px-3 py-2 text-slate-600">
                  {i.berth_name ?? i.detail?.berth ?? (i.detail?.berths ? i.detail.berths.join(' + ') : '—')}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {i.detail?.reason}
                  {i.detail?.ref && <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">{i.detail.ref}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {timelineLink(i) && (
                    <a href={timelineLink(i)!} className="mr-3 text-xs text-chart hover:underline">
                      On timeline
                    </a>
                  )}
                  {i.reservation_id && i.reservation_status === 'flagged' && (
                    <button onClick={() => setFixing(i)}
                      className="mr-3 rounded bg-chart px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700">
                      Fix
                    </button>
                  )}
                  <button onClick={() => resolve(i.id, !i.resolved)}
                    className="text-xs text-slate-500 hover:text-slate-900 hover:underline">
                    {i.resolved ? 'Reopen' : 'Mark done'}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && (data?.issues ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                Nothing here{tab === 'overlap' ? ' — no two legacy bookings ever claimed the same berth at the same time.' : '.'}
              </td></tr>
            )}
          </tbody>
        </table>
        {loading && <p className="px-3 py-6 text-center text-sm text-slate-500">Loading…</p>}
        {data?.total > (data?.issues?.length ?? 0) && (
          <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            Showing {data.issues.length} of {data.total}.
          </p>
        )}
      </div>

      {fixing && (
        <FixPanel issue={fixing} onClose={() => setFixing(null)}
          onFixed={() => { setFixing(null); load() }} />
      )}
    </div>
  )
}

/** Jump straight to the month the problem is in, whether or not it became a booking. */
function timelineLink(i: Issue): string | null {
  const d = i.start_date ?? i.detail?.date ?? i.detail?.start
  if (typeof d === 'string' && /^\d{4}-\d{2}/.test(d)) {
    return `/?y=${d.slice(0, 4)}&m=${Number(d.slice(5, 7))}`
  }
  return i.year ? `/?y=${i.year}&m=1` : null
}

function describe(i: Issue) {
  const d = i.detail ?? {}
  switch (i.kind) {
    case 'misfit':
      return (
        <span>
          <span className="font-medium">{d.vessel ?? i.vessel_name}</span>
          {d.vessel_ft ? ` (${d.vessel_ft} ft)` : ''} in a {d.berth_ft ?? i.detail?.berth_ft} ft berth
          {d.vessel_ft && d.berth_ft ? <span className="ml-1 text-flag">· {Number(d.vessel_ft) - Number(d.berth_ft)} ft too long</span> : null}
        </span>
      )
    case 'overlap':
      return (
        <span>
          <span className="font-medium">{d.vessel ?? d.title}</span> {d.start} – {d.end}
          {d.conflicts?.[0] && <span className="text-flag"> · clashes with {d.conflicts[0].vessel ?? d.conflicts[0].title}</span>}
        </span>
      )
    case 'vessel_conflict':
      return <span><span className="font-medium">{d.vessel}</span> on {d.date}</span>
    case 'unknown_berth':
      return <span><span className="font-medium">{d.text}</span> on {d.date ? fmtFull(d.date) : '—'}</span>
    case 'unknown_vessel':
      return <span className="font-medium">{d.vessel}</span>
    case 'annotation':
      return <span>“{d.text}” on {d.date ? fmtFull(d.date) : '—'}</span>
    default:
      return <span className="text-slate-600">{d.text ?? d.reason}</span>
  }
}

function Stat({ label, value, tone }: { label: string; value: number | undefined; tone?: 'good' | 'bad' | 'warn' }) {
  const colour =
    tone === 'bad' ? 'text-flag' : tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-900'
  return (
    <div className="rounded-xl border border-slate-300 bg-white px-3 py-2.5">
      <div className={`text-2xl font-semibold tabular-nums ${colour}`}>{value ?? '—'}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}
