import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** FR7: the audit report, filterable by year, berth and issue kind. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const year = p.get('year')
  const kind = p.get('kind')
  const berth = p.get('berth')
  const showResolved = p.get('resolved') === '1'
  const limit = Math.min(Number(p.get('limit') ?? 200), 1000)
  const offset = Number(p.get('offset') ?? 0)

  const where = sql`
    WHERE TRUE
      ${year ? sql`AND i.year = ${Number(year)}` : sql``}
      ${kind ? sql`AND i.kind = ${kind}::issue_kind` : sql``}
      ${berth ? sql`AND i.berth_id = ${Number(berth)}` : sql``}
      ${showResolved ? sql`` : sql`AND i.resolved = false`}`

  const [issues, counts, byYear, run, totals] = await Promise.all([
    sql`
      SELECT i.id, i.kind, i.year, i.detail, i.resolved, i.reservation_id,
             b.name AS berth_name,
             lower(r.during)::text AS start_date, (upper(r.during) - 1)::text AS end_date,
             v.id AS vessel_id, v.name AS vessel_name, v.length_ft AS vessel_length_ft,
             r.berth_id, r.status AS reservation_status
      FROM import_issues i
      LEFT JOIN berths b ON b.id = i.berth_id
      LEFT JOIN reservations r ON r.id = i.reservation_id
      LEFT JOIN vessels v ON v.id = r.vessel_id
      ${where}
      ORDER BY i.year NULLS LAST, i.id
      LIMIT ${limit} OFFSET ${offset}`,
    sql`SELECT i.kind, count(*)::int AS n FROM import_issues i WHERE i.resolved = false GROUP BY i.kind ORDER BY n DESC`,
    sql`SELECT i.year, count(*)::int AS n FROM import_issues i WHERE i.year IS NOT NULL AND i.resolved = false GROUP BY i.year ORDER BY i.year`,
    sql`SELECT source, started_at, stats FROM import_runs ORDER BY id DESC LIMIT 1`,
    sql`SELECT count(*)::int AS n FROM import_issues i ${where}`,
  ])

  return NextResponse.json({
    issues,
    counts,
    by_year: byYear,
    total: totals[0]?.n ?? 0,
    run: run[0] ?? null,
  })
}
