import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { mapPgError, HttpError } from '@/lib/errors'
import { reservationPatch, toRange, zodMessage } from '@/lib/validate'

export const dynamic = 'force-dynamic'

/** FR9: edit or cancel. Both re-run the rules, because both can break them. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const parsed = reservationPatch.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', message: zodMessage(parsed.error) }, { status: 400 })
  }
  const p = parsed.data

  const [current] = await sql<any[]>`
    SELECT id, berth_id, vessel_id, kind, title, status,
           lower(during)::text AS start_date, (upper(during) - 1)::text AS end_date
    FROM reservations WHERE id = ${Number(id)}`
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const start = p.start_date ?? current.start_date
  const end = p.end_date ?? current.end_date
  if (end < start) {
    return NextResponse.json({ error: 'invalid_dates', message: 'The end date must be on or after the start date.' }, { status: 400 })
  }
  const berthId = p.berth_id ?? current.berth_id
  const during = toRange(start, end)
  // Editing a flagged legacy row is how staff fix it (FR14): if it now passes
  // the rules it becomes active, and the database is what decides that.
  const status = p.status ?? (current.status === 'flagged' ? 'active' : current.status)

  try {
    await sql`
      UPDATE reservations SET
        berth_id  = ${berthId},
        vessel_id = ${p.vessel_id === undefined ? current.vessel_id : p.vessel_id},
        title     = ${p.title === undefined ? current.title : p.title},
        during    = ${during}::daterange,
        status    = ${status}
      WHERE id = ${Number(id)}`

    if (status === 'active' && current.status === 'flagged') {
      await sql`UPDATE import_issues SET resolved = true WHERE reservation_id = ${Number(id)}`
    }
    return NextResponse.json({ id: Number(id), status })
  } catch (e) {
    const mapped = await mapPgError(e, { berthId, during })
    if (mapped instanceof HttpError) return NextResponse.json(mapped.body, { status: mapped.status })
    throw e
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  await sql`UPDATE reservations SET status = 'cancelled' WHERE id = ${Number(id)}`
  return NextResponse.json({ id: Number(id), status: 'cancelled' })
}
