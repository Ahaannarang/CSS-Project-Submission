import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { mapPgError, HttpError } from '@/lib/errors'
import { reservationInput, toRange, zodMessage, parseId, parseDate } from '@/lib/validate'

export const dynamic = 'force-dynamic'

/** FR8/FR13: reservations in a window, optionally filtered. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const from = parseDate(p.get('from')) ?? '1900-01-01'
  const to = parseDate(p.get('to')) ?? '2200-01-01'
  const berth = parseId(p.get('berth'))
  const vessel = parseId(p.get('vessel'))
  const q = p.get('q')

  // A window that ends before it starts contains nothing. Handing it to
  // daterange() instead raises "range lower bound must be <= upper bound".
  if (to <= from) return NextResponse.json({ reservations: [] })

  const rows = await sql`
    SELECT r.id, r.berth_id, r.vessel_id, r.kind, r.title, r.status, r.source,
           lower(r.during)::text        AS start_date,
           (upper(r.during) - 1)::text  AS end_date,
           (upper(r.during) - lower(r.during))::int AS days,
           v.name AS vessel_name, v.length_ft AS vessel_length_ft,
           b.name AS berth_name, b.length_ft AS berth_length_ft
    FROM reservations r
    LEFT JOIN vessels v ON v.id = r.vessel_id
    JOIN berths b ON b.id = r.berth_id
    WHERE r.during && daterange(${from}::date, ${to}::date, '[)')
      AND r.status <> 'cancelled'
      ${berth ? sql`AND r.berth_id = ${berth}` : sql``}
      ${vessel ? sql`AND r.vessel_id = ${vessel}` : sql``}
      ${q ? sql`AND (v.name ILIKE ${'%' + q + '%'} OR r.title ILIKE ${'%' + q + '%'} OR b.name ILIKE ${'%' + q + '%'})` : sql``}
    ORDER BY lower(r.during), b.sort_order
    LIMIT 20000`

  return NextResponse.json({ reservations: rows })
}

/** FR1/FR2: create. The database decides; we only translate its answer. */
export async function POST(req: NextRequest) {
  const parsed = reservationInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', message: zodMessage(parsed.error) }, { status: 400 })
  }
  const v = parsed.data
  const during = toRange(v.start_date, v.end_date)

  try {
    const [row] = await sql`
      INSERT INTO reservations (berth_id, vessel_id, kind, title, during, status, source)
      VALUES (${v.berth_id}, ${v.kind === 'vessel' ? v.vessel_id! : null}, ${v.kind},
              ${v.title ?? null}, ${during}::daterange, 'active', 'manual')
      RETURNING id`
    return NextResponse.json({ id: row.id }, { status: 201 })
  } catch (e) {
    const mapped = await mapPgError(e, { berthId: v.berth_id, during })
    if (mapped instanceof HttpError) return NextResponse.json(mapped.body, { status: mapped.status })
    throw e
  }
}
