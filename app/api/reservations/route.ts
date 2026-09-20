import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { mapPgError, HttpError } from '@/lib/errors'
import { reservationInput, toRange, zodMessage } from '@/lib/validate'

export const dynamic = 'force-dynamic'

/** FR8/FR13: reservations in a window, optionally filtered. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const from = p.get('from') ?? '1997-01-01'
  const to = p.get('to') ?? '2030-01-01'
  const berth = p.get('berth')
  const vessel = p.get('vessel')
  const q = p.get('q')

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
      ${berth ? sql`AND r.berth_id = ${Number(berth)}` : sql``}
      ${vessel ? sql`AND r.vessel_id = ${Number(vessel)}` : sql``}
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
