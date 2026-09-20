'use client'

import Link from 'next/link'
import { fmtFull, ft } from '@/lib/dates'

/**
 * One vessel's whole history.
 *
 * The audit can say "this vessel was at two berths on the same day", but that is
 * only actionable if you can see the rest of its record and judge which entry is
 * the mistake. Days where the vessel appears at more than one berth are marked
 * here, in date order, alongside everything else it did.
 */
export default function VesselDetail({ data }: { data: any }) {
  const { vessel, stays, issues, summary, berth_use } = data

  // Which days does this vessel occupy twice over?
  const dayCount = new Map<string, Set<string>>()
  for (const s of stays) {
    for (let d = new Date(s.start_date + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= s.end_date; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10)
      if (!dayCount.has(k)) dayCount.set(k, new Set())
      dayCount.get(k)!.add(s.berth_name)
    }
  }
  const clashDays = new Set([...dayCount].filter(([, b]) => b.size > 1).map(([d]) => d))
  const stayClashes = (s: any) => {
    for (let d = new Date(s.start_date + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= s.end_date; d.setUTCDate(d.getUTCDate() + 1)) {
      if (clashDays.has(d.toISOString().slice(0, 10))) return true
    }
    return false
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href="/berths" className="text-sm text-chart hover:underline">← Berths &amp; vessels</Link>
        <h1 className="mt-1 text-xl font-semibold">{vessel.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {vessel.length_ft ? ft(vessel.length_ft) : 'No length on record — fit cannot be checked'}
          {vessel.type ? ` · ${vessel.type}` : ''}
        </p>
        {vessel.aliases?.length > 1 && (
          <p className="mt-1 text-xs text-slate-500">
            Written in the legacy sheets as: {vessel.aliases.join(' · ')}
          </p>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Stays" value={summary.stays} />
        <Stat label="Days alongside" value={summary.total_days} />
        <Stat label="Flagged" value={summary.flagged} tone={summary.flagged ? 'bad' : undefined} />
        <Stat label="Days in two places" value={clashDays.size} tone={clashDays.size ? 'bad' : undefined} />
      </section>

      {clashDays.size > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-medium">This vessel is recorded at more than one berth on {clashDays.size} day{clashDays.size === 1 ? '' : 's'}.</span>{' '}
          A vessel cannot be in two places, so at least one of the marked rows below is a transcription error in the original schedule.
        </div>
      )}

      {berth_use?.length > 0 && (
        <section className="rounded-xl border border-slate-300 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold">Berths used</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {berth_use.map((b: any) => (
              <li key={b.name} className="rounded-full border border-slate-200 px-3 py-1 text-sm">
                {b.name}
                <span className="ml-1.5 text-xs text-slate-500">
                  {b.length_ft ? `${Number(b.length_ft)} ft · ` : ''}{b.n} stay{b.n === 1 ? '' : 's'}
                </span>
                {vessel.length_ft && b.length_ft && Number(vessel.length_ft) > Number(b.length_ft) && (
                  <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">too short</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-300 bg-white">
        <h2 className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold">History</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Dates</th>
              <th className="px-3 py-2 font-semibold">Days</th>
              <th className="px-3 py-2 font-semibold">Berth</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stays.map((s: any) => {
              const clash = stayClashes(s)
              return (
                <tr key={s.id} className={clash ? 'bg-red-50/50' : ''}>
                  <td className="px-3 py-2 tabular-nums">
                    {fmtFull(s.start_date)}{s.days > 1 ? ` – ${fmtFull(s.end_date)}` : ''}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{s.days}</td>
                  <td className="px-3 py-2">
                    {s.berth_name}
                    <span className="ml-1.5 text-xs text-slate-500">{s.berth_length_ft ? `${Number(s.berth_length_ft)} ft` : '—'}</span>
                  </td>
                  <td className="px-3 py-2">
                    {s.status === 'flagged'
                      ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">flagged</span>
                      : <span className="text-xs text-slate-500">{s.source === 'legacy_import' ? 'imported' : 'booked here'}</span>}
                    {clash && <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">two berths</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/?y=${s.start_date.slice(0, 4)}&m=${Number(s.start_date.slice(5, 7))}`}
                      className="text-xs text-chart hover:underline">On timeline</Link>
                  </td>
                </tr>
              )
            })}
            {stays.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No bookings recorded.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {issues?.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-300 bg-white">
          <h2 className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold">Audit issues mentioning this vessel</h2>
          <ul className="divide-y divide-slate-100">
            {issues.map((i: any) => (
              <li key={i.id} className="flex items-baseline justify-between px-4 py-2 text-sm">
                <span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{i.kind}</span>
                  <span className="ml-2 text-slate-600">{i.detail?.reason}</span>
                </span>
                <span className="text-xs tabular-nums text-slate-400">{i.year ?? ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return (
    <div className="rounded-xl border border-slate-300 bg-white px-3 py-2.5">
      <div className={`text-2xl font-semibold tabular-nums ${tone === 'bad' ? 'text-flag' : 'text-slate-900'}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}
