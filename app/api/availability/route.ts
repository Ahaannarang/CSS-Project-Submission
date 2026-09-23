import { NextRequest, NextResponse } from 'next/server'
import { findOpenings } from '@/lib/availability'
import { parseId, parseDate } from '@/lib/validate'

export const dynamic = 'force-dynamic'

/** Earliest workable windows for a stay of a given length. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const from = parseDate(p.get('from'))
  const days = Number(p.get('days') ?? 1)
  if (!from) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'from is required, as a real YYYY-MM-DD date.' },
      { status: 400 },
    )
  }
  if (!Number.isFinite(days) || days < 1) {
    return NextResponse.json({ error: 'invalid_request', message: 'days must be 1 or more.' }, { status: 400 })
  }
  const result = await findOpenings({
    vesselId: parseId(p.get('vessel')),
    days,
    from,
    limit: p.get('limit') ? Number(p.get('limit')) : undefined,
  })
  return NextResponse.json(result)
}
