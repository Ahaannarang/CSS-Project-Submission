'use client'

import { useEffect, useState } from 'react'
import { fmtFull, ft } from '@/lib/dates'
import type { Suggestion } from './types'

/**
 * FR14 — repairing a flagged legacy booking.
 *
 * A flagged row is history that breaks a rule: usually a vessel on a berth too
 * short for it. Fixing it means choosing a berth that both fits and is free for
 * the original dates, which is exactly the question the suggester already
 * answers — so this reuses it rather than inventing a second ranking. Saving
 * goes through the ordinary edit endpoint, so the database gets the final say
 * and the row only becomes active if it genuinely passes both rules now.
 */
export default function FixPanel({
  issue, onClose, onFixed,
}: {
  issue: any
  onClose: () => void
  onFixed: () => void
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [reason, setReason] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = issue.start_date ?? issue.detail?.start
  const end = issue.end_date ?? issue.detail?.end

  useEffect(() => {
    if (!start || !end) { setLoading(false); return }
    const p = new URLSearchParams({ start, end, exclude: String(issue.reservation_id) })
    if (issue.vessel_id) p.set('vessel', String(issue.vessel_id))
    fetch(`/api/suggest?${p}`)
      .then((r) => r.json())
      .then((j) => { setSuggestions(j.suggestions ?? []); setReason(j.reason ?? null) })
      .finally(() => setLoading(false))
  }, [start, end, issue.vessel_id, issue.reservation_id])

  const moveTo = async (berthId: number) => {
    setBusy(true); setError(null)
    const res = await fetch(`/api/reservations/${issue.reservation_id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ berth_id: berthId }),
    })
    setBusy(false)
    if (res.ok) { onFixed(); return }
    const j = await res.json().catch(() => ({}))
    setError(j.message ?? 'That move was refused.')
  }

  const cancelBooking = async () => {
    setBusy(true); setError(null)
    const res = await fetch(`/api/reservations/${issue.reservation_id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })
    setBusy(false)
    if (res.ok) {
      await fetch(`/api/issues/${issue.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolved: true }),
      })
      onFixed()
    }
  }

  const d = issue.detail ?? {}

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Fix this booking</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {d.vessel ?? issue.vessel_name}
              {d.vessel_ft ? ` (${d.vessel_ft} ft)` : ''} on {issue.berth_name ?? d.berth}
              {d.berth_ft ? ` (${d.berth_ft} ft)` : ''}
              {start && end ? `, ${fmtFull(start)} – ${fmtFull(end)}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </header>

        <div className="px-5 py-4">
          {loading ? (
            <p className="text-sm text-slate-500">Looking for a berth that works…</p>
          ) : suggestions.length ? (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Berths that fit and are free for these dates
              </p>
              <ul className="space-y-1.5">
                {suggestions.map((s, i) => (
                  <li key={s.berth_id}>
                    <button disabled={busy} onClick={() => moveTo(s.berth_id)}
                      className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-chart hover:bg-blue-50 disabled:opacity-50">
                      <span>
                        <span className="font-medium">{s.name}</span>
                        <span className="ml-2 text-xs text-slate-500">{ft(s.length_ft)}</span>
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        i === 0 ? 'bg-chart text-white' : 'bg-slate-100 text-slate-600'}`}>
                        {s.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              {reason ?? 'No berth both fits this vessel and is free for these dates.'}
              <p className="mt-1 text-xs">The booking can be cancelled instead, which keeps it out of the schedule without deleting the record.</p>
            </div>
          )}

          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        </div>

        <footer className="flex items-center gap-2 border-t border-slate-200 px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Close</button>
          <button onClick={cancelBooking} disabled={busy}
            className="ml-auto rounded-lg px-3 py-2 text-sm text-flag hover:bg-red-50">
            Cancel this booking
          </button>
        </footer>
      </div>
    </div>
  )
}
