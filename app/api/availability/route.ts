import { NextRequest, NextResponse } from 'next/server'
import { findOpenings } from '@/lib/availability'

export const dynamic = 'force-dynamic'

/** Earliest workable windows for a stay of a given length. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const from = p.get('from')
  const days = Number(p.get('days') ?? 1)
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: 'invalid_request', message: 'from (YYYY-MM-DD) is required.' }, { status: 400 })
  }
  if (!Number.isFinite(days) || days < 1) {
    return NextResponse.json({ error: 'invalid_request', message: 'days must be 1 or more.' }, { status: 400 })
  }
  const result = await findOpenings({
    vesselId: p.get('vessel') ? Number(p.get('vessel')) : null,
    days,
    from,
    limit: p.get('limit') ? Number(p.get('limit')) : undefined,
  })
  return NextResponse.json(result)
}
