import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** FR14: a human has dealt with this one. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  await sql`UPDATE import_issues SET resolved = ${body.resolved !== false} WHERE id = ${Number(id)}`
  return NextResponse.json({ id: Number(id), resolved: body.resolved !== false })
}
