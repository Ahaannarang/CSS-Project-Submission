import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * A3: the clearance margin is a per-facility setting.
 *
 * Real berths need room for fenders and lines, so a facility may want a vessel
 * to be some feet shorter than its berth rather than merely not longer. Raising
 * it can invalidate bookings that were legal at the old value, so it behaves
 * like shortening a berth: report what would break, and only on confirmation
 * flag those rows rather than deleting them.
 */
export async function GET() {
  const rows = await sql`SELECT key, value FROM settings ORDER BY key`
  return NextResponse.json({ settings: Object.fromEntries(rows.map((r: any) => [r.key, Number(r.value)])) })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const margin = Number(body.margin_ft)
  if (!Number.isFinite(margin) || margin < 0 || margin > 500) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'The clearance margin must be between 0 and 500 ft.' },
      { status: 400 },
    )
  }

  const affected = await sql<any[]>`
    SELECT r.id, v.name AS vessel, v.length_ft AS vessel_ft, b.name AS berth, b.length_ft AS berth_ft,
           lower(r.during)::text AS start_date, (upper(r.during) - 1)::text AS end_date
    FROM reservations r
    JOIN vessels v ON v.id = r.vessel_id
    JOIN berths  b ON b.id = r.berth_id
    WHERE r.status = 'active' AND r.kind = 'vessel'
      AND v.length_ft IS NOT NULL AND b.length_ft IS NOT NULL
      AND v.length_ft + ${margin} > b.length_ft
    ORDER BY lower(r.during)`

  if (affected.length && !body.confirm) {
    return NextResponse.json({
      error: 'would_break_bookings',
      message: `A ${margin} ft clearance would leave ${affected.length} existing booking${affected.length === 1 ? '' : 's'} too tight.`,
      affected,
    }, { status: 409 })
  }

  if (affected.length) {
    await sql`UPDATE reservations SET status = 'flagged' WHERE id = ANY(${affected.map((a) => a.id)})`
    for (const a of affected) {
      await sql`
        INSERT INTO import_issues (reservation_id, kind, year, detail, issue_key)
        VALUES (${a.id}, 'misfit', ${Number(a.start_date.slice(0, 4))},
                ${sql.json({
                  vessel: a.vessel, vessel_ft: Number(a.vessel_ft),
                  berth: a.berth, berth_ft: Number(a.berth_ft),
                  reason: `clearance margin raised to ${margin} ft`,
                })},
                ${`misfit|margin-${margin}|${a.id}`})
        ON CONFLICT (issue_key) WHERE issue_key IS NOT NULL DO NOTHING`
    }
  }

  await sql`UPDATE settings SET value = ${margin} WHERE key = 'margin_ft'`
  return NextResponse.json({ margin_ft: margin, reflagged: affected.length })
}
