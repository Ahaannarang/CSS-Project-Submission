'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtFull, ft } from '@/lib/dates'
import type { Vessel } from './types'

/**
 * The question a coordinator actually gets asked.
 *
 * The booking panel answers "is this berth free on these dates". On the phone it
 * is usually the other way round: the vessel and the length of the stay are
 * fixed and the dates are negotiable. This screen answers "when is the soonest
 * you could take us, and where" — soonest first, best fit breaking ties, so it
 * never contradicts the berth suggester.
 */
export default function Availability({ vessels }: { vessels: Vessel[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const [vesselId, setVesselId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [days, setDays] = useState(5)
  const [from, setFrom] = useState(today)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return vessels.slice(0, 8)
    return vessels.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 8)
  }, [vessels, query])

  const selected = vessels.find((v) => v.id === vesselId) ?? null

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ from, days: String(days), limit: '10' })
    if (vesselId) p.set('vessel', String(vesselId))
    const j = await fetch(`/api/availability?${p}`, { cache: 'no-store' }).then((r) => r.json())
    setData(j); setLoading(false)
  }, [from, days, vesselId])

  useEffect(() => { load() }, [load])

  const book = (berthId: number, start: string, end: string) => {
    const p = new URLSearchParams({ y: start.slice(0, 4), m: String(Number(start.slice(5, 7))) })
    window.location.href = `/?${p}&book=1&berth=${berthId}&start=${start}&end=${end}${vesselId ? `&vessel=${vesselId}` : ''}`
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Find a slot</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          For a vessel and a length of stay, the earliest dates each berth could actually take it.
          Berths with no recorded length are left out, because their fit cannot be checked.
        </p>
      </div>

      <div className="grid gap-4 rounded-xl border border-slate-300 bg-white px-5 py-4 lg:grid-cols-[2fr_1fr_1fr]">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Vessel</label>
          <input value={selected ? selected.name : query}
            onChange={(e) => { setQuery(e.target.value); setVesselId(null) }}
            placeholder="Search, or leave blank for an event"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-chart" />
          {selected ? (
            <p className="mt-1.5 text-xs text-slate-600">
              <span className="font-medium">{selected.name}</span> · {ft(selected.length_ft)}
              <button onClick={() => { setVesselId(null); setQuery('') }}
                className="ml-2 text-chart hover:underline">change</button>
            </p>
          ) : (
            <ul className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-slate-200">
              {matches.map((v) => (
                <li key={v.id}>
                  <button onClick={() => { setVesselId(v.id); setQuery(v.name) }}
                    className="flex w-full items-baseline justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                    <span>{v.name}</span><span className="text-xs text-slate-500">{ft(v.length_ft)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Nights alongside</span>
          <input type="number" min={1} max={365} value={days}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums outline-none focus:border-chart" />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Not before</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-chart" />
        </label>
      </div>

      {loading && <p className="text-sm text-slate-500">Looking…</p>}

      {!loading && data?.reason && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{data.reason}</div>
      )}

      {!loading && data?.openings?.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Berth</th>
                <th className="px-3 py-2 font-semibold">Earliest {days}-day stay</th>
                <th className="px-3 py-2 font-semibold">Free window</th>
                <th className="px-3 py-2 font-semibold">Why</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.openings.map((o: any, i: number) => (
                <tr key={o.berth_id} className={i === 0 ? 'bg-blue-50/40' : ''}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{o.name}</span>
                    <span className="ml-2 text-xs text-slate-500">{ft(o.length_ft)}</span>
                    {i === 0 && <span className="ml-2 rounded-full bg-chart px-2 py-0.5 text-[11px] font-medium text-white">Soonest</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtFull(o.start_date)} – {fmtFull(o.end_date)}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">
                    {o.window_days == null ? 'open-ended' : `${o.window_days} days`}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {o.reason}{o.slack_ft != null ? ` · ${o.slack_ft} ft spare` : ''}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => book(o.berth_id, o.start_date, o.end_date)}
                      className="rounded bg-chart px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700">
                      Book it
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.fit_checked && (
            <p className="border-t border-slate-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              No vessel chosen, or the chosen vessel has no length on record — these results are not fit-checked.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
