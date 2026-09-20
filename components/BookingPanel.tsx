'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Alternative, Berth, Reservation, Suggestion, Vessel } from './types'
import { fmtDay, fmtFull, ft } from '@/lib/dates'

type State =
  | { mode: 'create'; berthId: number | null; vesselId?: number | null; start: string; end: string }
  | { mode: 'edit'; reservation: Reservation }

/**
 * Book in under 30 seconds.
 *
 * Suggestions and conflicts refresh as the dates change, so the coordinator sees
 * the answer before pressing save rather than after a rejection. The save can
 * still fail — the database is the only real authority — and when it does, the
 * error names the booking in the way and offers the berth to use instead.
 */
export default function BookingPanel({
  state, berths, vessels, onClose, onSaved,
}: {
  state: State
  berths: Berth[]
  vessels: Vessel[]
  onClose: () => void
  onSaved: () => void
}) {
  const editing = state.mode === 'edit' ? state.reservation : null

  const [kind, setKind] = useState<'vessel' | 'event'>(editing?.kind ?? 'vessel')
  const preset = state.mode === 'create' ? state.vesselId ?? null : null
  const [vesselId, setVesselId] = useState<number | null>(editing?.vessel_id ?? preset)
  const [vesselQuery, setVesselQuery] = useState(
    editing?.vessel_name ?? (preset ? vessels.find((v) => v.id === preset)?.name ?? '' : ''),
  )
  const [title, setTitle] = useState(editing?.title ?? '')
  const [berthId, setBerthId] = useState<number | null>(
    editing ? editing.berth_id : state.mode === 'create' ? state.berthId : null,
  )
  const [start, setStart] = useState(editing?.start_date ?? (state.mode === 'create' ? state.start : ''))
  const [end, setEnd] = useState(editing?.end_date ?? (state.mode === 'create' ? state.end : ''))

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [unverified, setUnverified] = useState<Suggestion[]>([])
  const [alternatives, setAlternatives] = useState<Alternative[]>([])
  const [emptyReason, setEmptyReason] = useState<string | null>(null)
  const [fitChecked, setFitChecked] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; conflicts?: any[] } | null>(null)

  useEffect(() => {
    if (preset && !vesselQuery) {
      const v = vessels.find((x) => x.id === preset)
      if (v) setVesselQuery(v.name)
    }
  }, [preset, vessels, vesselQuery])

  const datesValid = !!start && !!end && end >= start
  const selectedVessel = useMemo(() => vessels.find((v) => v.id === vesselId) ?? null, [vessels, vesselId])

  const matches = useMemo(() => {
    const q = vesselQuery.trim().toLowerCase()
    if (!q) return vessels.slice(0, 8)
    return vessels.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 8)
  }, [vessels, vesselQuery])

  // Live suggestions: re-asked whenever the inputs that matter change.
  useEffect(() => {
    if (!datesValid || (kind === 'vessel' && !vesselId)) { setSuggestions([]); setEmptyReason(null); return }
    const ctl = new AbortController()
    const params = new URLSearchParams({ start, end })
    if (kind === 'vessel' && vesselId) params.set('vessel', String(vesselId))
    if (editing) params.set('exclude', String(editing.id))
    fetch(`/api/suggest?${params}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => {
        setSuggestions(j.suggestions ?? [])
        setUnverified(j.unverified ?? [])
        setAlternatives(j.alternatives ?? [])
        setEmptyReason(j.reason ?? null)
        setFitChecked(j.fit_checked ?? true)
        if (berthId == null && j.suggestions?.length) setBerthId(j.suggestions[0].berth_id)
      })
      .catch(() => {})
    return () => ctl.abort()
  }, [start, end, vesselId, kind, datesValid, editing])

  // Is the berth currently picked actually one of the free ones?
  const berthWarning = useMemo(() => {
    if (berthId == null || (!suggestions.length && !unverified.length)) return null
    if (suggestions.some((s) => s.berth_id === berthId)) return null
    if (unverified.some((s) => s.berth_id === berthId)) return null
    const b = berths.find((x) => x.id === berthId)
    return b ? `${b.name} is not free for these dates, or the vessel does not fit it.` : null
  }, [berthId, suggestions, unverified, berths])

  const save = async () => {
    setBusy(true); setError(null)
    const body: any = { kind, berth_id: berthId, start_date: start, end_date: end }
    if (kind === 'vessel') body.vessel_id = vesselId
    else body.title = title

    const res = editing
      ? await fetch(`/api/reservations/${editing.id}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        })
      : await fetch('/api/reservations', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        })

    setBusy(false)
    if (res.ok) { onSaved(); return }
    const j = await res.json().catch(() => ({}))
    setError({ message: j.message ?? 'That booking could not be saved.', conflicts: j.conflicts })
  }

  const cancelBooking = async () => {
    if (!editing) return
    setBusy(true)
    await fetch(`/api/reservations/${editing.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }),
    })
    setBusy(false); onSaved()
  }

  const canSave =
    datesValid && berthId != null && (kind === 'vessel' ? vesselId != null : title.trim().length > 0)

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{editing ? 'Edit booking' : 'New booking'}</h2>
            {editing && (
              <p className="text-xs text-slate-500">
                {editing.source === 'legacy_import' ? 'Imported from the legacy schedule' : 'Created here'}
                {editing.status === 'flagged' && ' · flagged'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100" aria-label="Close">✕</button>
        </header>

        <div className="flex-1 space-y-5 px-5 py-4">
          {!editing && (
            <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
              {(['vessel', 'event'] as const).map((k) => (
                <button key={k} onClick={() => setKind(k)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${kind === k ? 'bg-chart text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {k}
                </button>
              ))}
            </div>
          )}

          {kind === 'vessel' ? (
            <Field label="Vessel">
              <input
                value={vesselQuery}
                onChange={(e) => { setVesselQuery(e.target.value); setVesselId(null) }}
                placeholder="Search vessels with a known length"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-chart" />
              {selectedVessel ? (
                <p className="mt-1.5 text-xs text-slate-600">
                  <span className="font-medium">{selectedVessel.name}</span> · {ft(selectedVessel.length_ft)}
                  {selectedVessel.type ? ` · ${selectedVessel.type}` : ''}
                </p>
              ) : (
                <ul className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-slate-200">
                  {matches.map((v) => (
                    <li key={v.id}>
                      <button
                        onClick={() => { setVesselId(v.id); setVesselQuery(v.name); setBerthId(null) }}
                        className="flex w-full items-baseline justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                        <span>{v.name}</span>
                        <span className="text-xs text-slate-500">{ft(v.length_ft)}</span>
                      </button>
                    </li>
                  ))}
                  {matches.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">No vessel matches that.</li>}
                </ul>
              )}
            </Field>
          ) : (
            <Field label="Event name">
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Community sail day"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-chart" />
              <p className="mt-1.5 text-xs text-slate-500">An event occupies the whole berth and has no length (A4).</p>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="First day">
              <input type="date" value={start}
                onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value) }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-chart" />
            </Field>
            <Field label="Last day">
              <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-chart" />
            </Field>
          </div>
          {datesValid && (
            <p className="-mt-3 text-xs text-slate-500">
              {fmtDay(start)} – {fmtDay(end)}, both days inclusive.
            </p>
          )}
          {!datesValid && start && end && (
            <p className="-mt-3 text-xs text-flag">The last day must be on or after the first day.</p>
          )}

          <Field label={kind === 'vessel' ? 'Berth' : 'Berth (events skip the fit check)'}>
            {suggestions.length > 0 ? (
              <ul className="space-y-1.5">
                {suggestions.map((s, i) => (
                  <li key={s.berth_id}>
                    <button onClick={() => setBerthId(s.berth_id)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                        berthId === s.berth_id ? 'border-chart bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                      <span>
                        <span className="font-medium">{s.name}</span>
                        <span className="ml-2 text-xs text-slate-500">{s.length_ft ? ft(s.length_ft) : 'length unknown'}</span>
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        i === 0 ? 'bg-chart text-white' : 'bg-slate-100 text-slate-600'}`}>
                        {s.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : emptyReason ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <p className="font-medium">{emptyReason}</p>
                {alternatives.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs">
                    {alternatives.map((a, i) => (
                      <li key={i}>
                        <button
                          onClick={() => {
                            setBerthId(a.berth_id)
                            if (a.start_date && a.end_date) { setStart(a.start_date); setEnd(a.end_date) }
                          }}
                          className="underline decoration-amber-400 underline-offset-2 hover:text-amber-950">
                          {a.reason}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <select value={berthId ?? ''} onChange={(e) => setBerthId(e.target.value ? Number(e.target.value) : null)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-chart">
                <option value="">Choose a berth…</option>
                {berths.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.length_ft ? ft(b.length_ft) : 'length unknown'}</option>)}
              </select>
            )}
            {unverified.length > 0 && (
              <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Free, but fit not checked
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  These berths have no length on record, so the rule cannot be applied to them.
                </p>
                <ul className="mt-1.5 space-y-1">
                  {unverified.map((s) => (
                    <li key={s.berth_id}>
                      <button onClick={() => setBerthId(s.berth_id)}
                        className={`flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-sm ${
                          berthId === s.berth_id ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        <span>{s.name}</span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                          Fit unknown
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!fitChecked && kind === 'vessel' && vesselId && (
              <p className="mt-1.5 text-xs text-amber-700">
                This vessel has no length on record, so fit cannot be checked.
              </p>
            )}
            {berthWarning && <p className="mt-1.5 text-xs text-flag">{berthWarning}</p>}
          </Field>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <p className="font-medium">{error.message}</p>
              {suggestions[0] && (
                <p className="mt-1 text-xs">
                  Try <button onClick={() => setBerthId(suggestions[0].berth_id)} className="font-medium underline">
                    {suggestions[0].name}
                  </button> ({suggestions[0].label.toLowerCase()}).
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-slate-200 px-5 py-4">
          <button onClick={save} disabled={!canSave || busy}
            className="rounded-lg bg-chart px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Book it'}
          </button>
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          {editing && (
            <button onClick={cancelBooking} disabled={busy}
              className="ml-auto rounded-lg px-3 py-2 text-sm text-flag hover:bg-red-50">
              Cancel booking
            </button>
          )}
        </footer>
      </aside>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}
