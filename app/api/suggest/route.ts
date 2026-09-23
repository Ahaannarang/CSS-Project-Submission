import { NextRequest, NextResponse } from 'next/server'
import { suggestBerths } from '@/lib/suggest'
import { parseId, parseDate } from '@/lib/validate'

export const dynamic = 'force-dynamic'

/** FR5: ranked berths for a vessel and a date range. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const start = parseDate(p.get('start'))
  const end = parseDate(p.get('end'))
  if (!start || !end) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'start and end are required, as real YYYY-MM-DD dates.' },
      { status: 400 },
    )
  }
  if (end < start) {
    return NextResponse.json({ error: 'invalid_dates', message: 'The end date must be on or after the start date.' }, { status: 400 })
  }
  const vesselId = parseId(p.get('vessel'))
  const exclude = parseId(p.get('exclude'))

  const result = await suggestBerths({ vesselId, startDate: start, endDate: end, excludeReservationId: exclude })
  return NextResponse.json(result)
}
