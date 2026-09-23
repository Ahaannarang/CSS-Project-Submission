import { NextRequest, NextResponse } from 'next/server'
import { getVessel } from '@/lib/vessel'
import { parseId } from '@/lib/validate'

export const dynamic = 'force-dynamic'

/** Everything known about one vessel, including the audit issues naming it. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const vesselId = parseId(id)
  if (vesselId == null) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const data = await getVessel(vesselId)
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(data)
}
