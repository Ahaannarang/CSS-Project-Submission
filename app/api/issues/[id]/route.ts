import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { parseId } from '@/lib/validate'

export const dynamic = 'force-dynamic'

/** FR14: a human has dealt with this one. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params
  const id = parseId(rawId)
  if (id == null) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  await sql`UPDATE import_issues SET resolved = ${body.resolved !== false} WHERE id = ${id}`
  return NextResponse.json({ id, resolved: body.resolved !== false })
}
