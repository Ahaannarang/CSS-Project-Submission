'use client'

import { useCallback, useEffect, useState } from 'react'
import { ft } from '@/lib/dates'
import type { Berth, Vessel } from './types'

/**
 * FR10: reference data.
 *
 * Both edits here can invalidate bookings that already exist — shortening a
 * berth, or correcting a vessel's length upward. Neither is refused outright:
 * the API reports what would break, and on confirmation the affected bookings
 * are flagged rather than deleted, so the history stays intact.
 */
export default function Reference({ initialBerths }: { initialBerths: Berth[] }) {
  const [tab, setTab] = useState<'berths' | 'vessels'>('berths')
  const [berths, setBerths] = useState(initialBerths)
  const [vessels, setVessels] = useState<Vessel[]>([])
  const [q, setQ] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)
  const [adding, setAdding] = useState(false)

  const loadVessels = useCallback(async () => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    const j = await fetch(`/api/vessels?${p}`, { cache: 'no-store' }).then((r) => r.json())
    setVessels(j.vessels ?? [])
  }, [q])

  useEffect(() => { if (tab === 'vessels') loadVessels() }, [tab, loadVessels])

  const reloadBerths = async () => {
    const j = await fetch('/api/berths', { cache: 'no-store' }).then((r) => r.json())
    setBerths(j.berths ?? [])
  }

  const saveBerth = async (b: Berth, lengthFt: string) => {
    const send = (confirm?: boolean) =>
      fetch(`/api/berths/${b.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ length_ft: lengthFt === '' ? null : Number(lengthFt), confirm }),
      })
    let res = await send()
    if (res.status === 409) {
      const j = await res.json()
      if (!window.confirm(`${j.message}\n\nFlag those bookings and continue?`)) return
      res = await send(true)
    }
    if (res.ok) { setNotice({ tone: 'ok', text: `${b.name} updated.` }); reloadBerths() }
  }

  const saveVessel = async (v: Vessel, lengthFt: string) => {
    const send = (confirm?: boolean) =>
      fetch('/api/vessels', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: v.id, length_ft: lengthFt === '' ? null : Number(lengthFt), confirm }),
      })
    let res = await send()
    if (res.status === 409) {
      const j = await res.json()
      if (!window.confirm(`${j.message}\n\nFlag those bookings and continue?`)) return
      res = await send(true)
    }
    if (res.ok) {
      const j = await res.json()
      setNotice({
        tone: j.reflagged ? 'warn' : 'ok',
        text: j.reflagged ? `${v.name} updated; ${j.reflagged} booking(s) flagged as misfits.` : `${v.name} updated.`,
      })
      loadVessels()
    }
  }

  const createBerth = async (name: string, lengthFt: string) => {
    const res = await fetch('/api/berths', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, length_ft: lengthFt === '' ? null : Number(lengthFt) }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { setNotice({ tone: 'ok', text: `${name} added.` }); setAdding(false); reloadBerths(); return true }
    setNotice({ tone: 'bad', text: j.message ?? 'That berth could not be added.' })
    return false
  }

  const createVessel = async (name: string, lengthFt: string, type: string) => {
    const res = await fetch('/api/vessels', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, length_ft: lengthFt === '' ? null : Number(lengthFt), type: type || null }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { setNotice({ tone: 'ok', text: `${name} added.` }); setAdding(false); loadVessels(); return true }
    setNotice({ tone: 'bad', text: j.message ?? 'That vessel could not be added.' })
    return false
  }

  const shown = onlyMissing ? vessels.filter((v) => v.length_ft == null) : vessels
  const missing = vessels.filter((v) => v.length_ft == null).length

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Berths &amp; vessels</h1>

      <div className="flex gap-1 border-b border-slate-200">
        {(['berths', 'vessels'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium capitalize ${
              tab === t ? 'border-chart text-chart' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t}
          </button>
        ))}
      </div>

      {notice && (
        <div className={`rounded-lg px-3 py-2 text-sm ${
          notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800'
            : notice.tone === 'bad' ? 'bg-red-50 text-red-800'
              : 'bg-amber-50 text-amber-900'}`}>
          {notice.text}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => { setAdding((a) => !a); setNotice(null) }}
          className="rounded-lg bg-chart px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {adding ? 'Close' : tab === 'berths' ? 'Add a berth' : 'Add a vessel'}
        </button>
        {tab === 'vessels' && (
          <p className="text-sm text-slate-500">
            Adding a length to a vessel that has none turns the fit rule on for all of its bookings.
          </p>
        )}
      </div>

      {adding && (tab === 'berths'
        ? <CreateBerth onCreate={createBerth} onCancel={() => setAdding(false)} />
        : <CreateVessel onCreate={createVessel} onCancel={() => setAdding(false)} />)}

      {tab === 'berths' ? (
        <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Berth</th>
                <th className="px-3 py-2 font-semibold">Length</th>
                <th className="px-3 py-2 font-semibold">Bookings</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {berths.map((b) => <BerthRow key={b.id} berth={b} onSave={saveBerth} />)}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            Two sections in the legacy sheets (North Finger Piers, Small craft slips) carry no length, so the
            fit rule cannot be applied to them. Give them a length here to turn the rule on.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vessels"
              className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-chart" />
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
              Only those missing a length ({missing})
            </label>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Vessel</th>
                  <th className="px-3 py-2 font-semibold">Length</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Bookings</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((v) => <VesselRow key={v.id} vessel={v} onSave={saveVessel} />)}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
              Showing {shown.length} vessels. A vessel with no length can still be booked, but its fit is not
              checked — the audit lists every one of them.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function BerthRow({ berth, onSave }: { berth: Berth; onSave: (b: Berth, v: string) => void }) {
  const [value, setValue] = useState(berth.length_ft ?? '')
  const dirty = String(value) !== String(berth.length_ft ?? '')
  return (
    <tr>
      <td className="px-3 py-2 font-medium">{berth.name}</td>
      <td className="px-3 py-2">
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="unknown"
          className="w-24 rounded border border-slate-300 px-2 py-1 text-sm tabular-nums outline-none focus:border-chart" />
        <span className="ml-1 text-xs text-slate-400">ft</span>
      </td>
      <td className="px-3 py-2 tabular-nums text-slate-600">{berth.active_count}</td>
      <td className="px-3 py-2 text-right">
        {dirty && (
          <button onClick={() => onSave(berth, String(value))}
            className="rounded bg-chart px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700">Save</button>
        )}
      </td>
    </tr>
  )
}

function VesselRow({ vessel, onSave }: { vessel: Vessel; onSave: (v: Vessel, l: string) => void }) {
  const [value, setValue] = useState(vessel.length_ft ?? '')
  const dirty = String(value) !== String(vessel.length_ft ?? '')
  return (
    <tr className={vessel.length_ft == null ? 'bg-amber-50/40' : ''}>
      <td className="px-3 py-2 font-medium">
        <a href={`/vessels/${vessel.id}`} className="hover:text-chart hover:underline">{vessel.name}</a>
      </td>
      <td className="px-3 py-2">
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="unknown"
          className="w-24 rounded border border-slate-300 px-2 py-1 text-sm tabular-nums outline-none focus:border-chart" />
        <span className="ml-1 text-xs text-slate-400">ft</span>
      </td>
      <td className="px-3 py-2 text-slate-600">{vessel.type ?? '—'}</td>
      <td className="px-3 py-2 tabular-nums text-slate-600">{vessel.booking_count}</td>
      <td className="px-3 py-2 text-right">
        {dirty && (
          <button onClick={() => onSave(vessel, String(value))}
            className="rounded bg-chart px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700">Save</button>
        )}
      </td>
    </tr>
  )
}


function CreateBerth({ onCreate, onCancel }: { onCreate: (n: string, l: string) => Promise<boolean>; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [length, setLength] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim()) return
    setBusy(true); await onCreate(name.trim(), length); setBusy(false)
  }
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3"
      onSubmit={(e) => { e.preventDefault(); submit() }}>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="South Pier Outer"
          className="w-60 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-chart" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Length (ft)</span>
        <input value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" placeholder="optional"
          className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums outline-none focus:border-chart" />
      </label>
      <button type="submit" disabled={!name.trim() || busy}
        className="rounded-lg bg-chart px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
        Add berth
      </button>
      <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
      <p className="w-full text-xs text-slate-500">
        A berth with no length can still be booked, but the fit rule cannot be applied to it.
      </p>
    </form>
  )
}

function CreateVessel({ onCreate, onCancel }: { onCreate: (n: string, l: string, t: string) => Promise<boolean>; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [length, setLength] = useState('')
  const [type, setType] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim()) return
    setBusy(true); await onCreate(name.trim(), length, type.trim()); setBusy(false)
  }
  return (
    <form className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3"
      onSubmit={(e) => { e.preventDefault(); submit() }}>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="R/V Atlantis"
          className="w-60 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-chart" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Length (ft)</span>
        <input value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" placeholder="optional"
          className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums outline-none focus:border-chart" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Type</span>
        <input value={type} onChange={(e) => setType(e.target.value)} placeholder="research"
          className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-chart" />
      </label>
      <button type="submit" disabled={!name.trim() || busy}
        className="rounded-lg bg-chart px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
        Add vessel
      </button>
      <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
    </form>
  )
}
