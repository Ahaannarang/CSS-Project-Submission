import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { berthInput, zodMessage } from '@/lib/validate'

export const dynamic = 'force-dynamic'

/**
 * FR10: editing reference data.
 *
 * Shortening a berth cannot break history retroactively (the fit trigger only
 * fires on the reservation), so the danger is silent: bookings that no longer
 * fit would simply sit there. The API looks for them and refuses unless the
 * caller confirms, then flags the ones now too long.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const parsed = berthInput.partial().safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request', message: zodMessage(parsed.error) }, { status: 400 })

  const [current] = await sql<any[]>`SELECT id, name, length_ft FROM berths WHERE id = ${Number(id)}`
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const newLength = parsed.data.length_ft === undefined ? current.length_ft : parsed.data.length_ft
  const shortening = newLength != null && current.length_ft != null && Number(newLength) < Number(current.length_ft)

  if (shortening) {
    const affected = await sql<any[]>`
      SELECT r.id, v.name AS vessel, v.length_ft,
             lower(r.during)::text AS start_date, (upper(r.during) - 1)::text AS end_date
      FROM reservations r JOIN vessels v ON v.id = r.vessel_id
      WHERE r.berth_id = ${Number(id)} AND r.status = 'active'
        AND v.length_ft > ${newLength}::numeric
      ORDER BY lower(r.during)`
    if (affected.length && !body.confirm) {
      return NextResponse.json({
        error: 'would_break_bookings',
        message: `${affected.length} booking${affected.length === 1 ? '' : 's'} on ${current.name} would no longer fit at ${newLength} ft.`,
        affected,
      }, { status: 409 })
    }
    if (affected.length) {
      // Confirmed: keep the history but mark it, rather than deleting bookings.
      await sql`UPDATE reservations SET status = 'flagged' WHERE id = ANY(${affected.map((a) => a.id)})`
      for (const a of affected) {
        await sql`
          INSERT INTO import_issues (reservation_id, kind, year, berth_id, detail, issue_key)
          VALUES (${a.id}, 'misfit', ${Number(a.start_date.slice(0, 4))}, ${Number(id)},
                  ${sql.json({ vessel: a.vessel, vessel_ft: Number(a.length_ft), berth: current.name, berth_ft: Number(newLength), reason: 'berth was shortened below this vessel' })},
                  ${`misfit|shortened|${a.id}`})
          ON CONFLICT (issue_key) WHERE issue_key IS NOT NULL DO NOTHING`
      }
    }
  }

  await sql`
    UPDATE berths SET
      name      = ${parsed.data.name ?? current.name},
      length_ft = ${newLength},
      notes     = ${parsed.data.notes === undefined ? sql`notes` : parsed.data.notes}
    WHERE id = ${Number(id)}`
  return NextResponse.json({ id: Number(id), length_ft: newLength })
}
