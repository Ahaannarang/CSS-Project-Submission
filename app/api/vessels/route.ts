import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { vesselInput, zodMessage } from '@/lib/validate'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')
  const withLength = req.nextUrl.searchParams.get('with_length') === '1'
  const rows = await sql`
    SELECT v.id, v.name, v.length_ft, v.type,
           count(r.id) FILTER (WHERE r.status <> 'cancelled')::int AS booking_count
    FROM vessels v LEFT JOIN reservations r ON r.vessel_id = v.id
    WHERE TRUE
      ${q ? sql`AND v.name ILIKE ${'%' + q + '%'}` : sql``}
      ${withLength ? sql`AND v.length_ft IS NOT NULL` : sql``}
    GROUP BY v.id
    ORDER BY (v.length_ft IS NULL), v.name
    LIMIT 500`
  return NextResponse.json({ vessels: rows })
}

export async function POST(req: NextRequest) {
  const parsed = vesselInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request', message: zodMessage(parsed.error) }, { status: 400 })
  try {
    const [row] = await sql`
      INSERT INTO vessels (name, length_ft, type)
      VALUES (${parsed.data.name}, ${parsed.data.length_ft ?? null}, ${parsed.data.type ?? null})
      RETURNING id`
    return NextResponse.json({ id: row.id }, { status: 201 })
  } catch (e: any) {
    if (e.code === '23505') return NextResponse.json({ error: 'duplicate', message: 'A vessel with that name already exists.' }, { status: 409 })
    throw e
  }
}

/** Setting a length on a vessel that had none is the main way to close the data gap. */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const id = Number(body.id)
  if (!id) return NextResponse.json({ error: 'invalid_request', message: 'id is required.' }, { status: 400 })
  const parsed = vesselInput.partial().safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request', message: zodMessage(parsed.error) }, { status: 400 })

  const [current] = await sql<any[]>`SELECT id, name, length_ft, type FROM vessels WHERE id = ${id}`
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const newLength = parsed.data.length_ft === undefined ? current.length_ft : parsed.data.length_ft
  const affected = newLength == null ? [] : await sql<any[]>`
    SELECT r.id, b.name AS berth, b.length_ft AS berth_ft,
           lower(r.during)::text AS start_date, (upper(r.during) - 1)::text AS end_date
    FROM reservations r JOIN berths b ON b.id = r.berth_id
    WHERE r.vessel_id = ${id} AND r.status = 'active'
      AND b.length_ft IS NOT NULL AND b.length_ft < ${newLength}::numeric`

  if (affected.length && !body.confirm) {
    return NextResponse.json({
      error: 'would_break_bookings',
      message: `${current.name} at ${newLength} ft no longer fits ${affected.length} of its existing booking${affected.length === 1 ? '' : 's'}.`,
      affected,
    }, { status: 409 })
  }
  if (affected.length) {
    await sql`UPDATE reservations SET status = 'flagged' WHERE id = ANY(${affected.map((a) => a.id)})`
    for (const a of affected) {
      await sql`
        INSERT INTO import_issues (reservation_id, kind, year, berth_id, detail, issue_key)
        VALUES (${a.id}, 'misfit', ${Number(a.start_date.slice(0, 4))}, NULL,
                ${sql.json({ vessel: current.name, vessel_ft: Number(newLength), berth: a.berth, berth_ft: Number(a.berth_ft), reason: 'vessel length was corrected upward' })},
                ${`misfit|vessel-corrected|${a.id}`})
        ON CONFLICT (issue_key) WHERE issue_key IS NOT NULL DO NOTHING`
    }
  }

  await sql`
    UPDATE vessels SET
      name = ${parsed.data.name ?? current.name},
      length_ft = ${newLength},
      type = ${parsed.data.type === undefined ? current.type : parsed.data.type}
    WHERE id = ${id}`
  return NextResponse.json({ id, length_ft: newLength, reflagged: affected.length })
}
