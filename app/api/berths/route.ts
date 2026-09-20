import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { berthInput, zodMessage } from '@/lib/validate'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await sql`
    SELECT b.id, b.name, b.length_ft, b.notes, b.sort_order,
           count(r.id) FILTER (WHERE r.status = 'active')::int AS active_count
    FROM berths b LEFT JOIN reservations r ON r.berth_id = b.id
    GROUP BY b.id ORDER BY b.sort_order, b.name`
  return NextResponse.json({ berths: rows })
}

export async function POST(req: NextRequest) {
  const parsed = berthInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request', message: zodMessage(parsed.error) }, { status: 400 })
  try {
    const [row] = await sql`
      INSERT INTO berths (name, length_ft, notes)
      VALUES (${parsed.data.name}, ${parsed.data.length_ft ?? null}, ${parsed.data.notes ?? null})
      RETURNING id`
    return NextResponse.json({ id: row.id }, { status: 201 })
  } catch (e: any) {
    if (e.code === '23505') return NextResponse.json({ error: 'duplicate', message: 'A berth with that name already exists.' }, { status: 409 })
    throw e
  }
}
