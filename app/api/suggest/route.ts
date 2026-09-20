import { NextRequest, NextResponse } from 'next/server'
import { suggestBerths } from '@/lib/suggest'

export const dynamic = 'force-dynamic'

/** FR5: ranked berths for a vessel and a date range. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const start = p.get('start')
  const end = p.get('end')
  if (!start || !end) {
    return NextResponse.json({ error: 'invalid_request', message: 'start and end are required.' }, { status: 400 })
  }
  if (end < start) {
    return NextResponse.json({ error: 'invalid_dates', message: 'The end date must be on or after the start date.' }, { status: 400 })
  }
  const vesselId = p.get('vessel') ? Number(p.get('vessel')) : null
  const exclude = p.get('exclude') ? Number(p.get('exclude')) : null

  const result = await suggestBerths({ vesselId, startDate: start, endDate: end, excludeReservationId: exclude })
  return NextResponse.json(result)
}
