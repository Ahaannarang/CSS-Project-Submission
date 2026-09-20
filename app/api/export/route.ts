import { NextRequest } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** FR15: the current schedule as CSV, honouring the same filters as the timeline. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const from = p.get('from') ?? '1900-01-01'
  const to = p.get('to') ?? '2100-01-01'
  const what = p.get('what') ?? 'reservations'

  const rows =
    what === 'issues'
      ? await sql`
          SELECT i.kind AS issue, i.year, b.name AS berth, i.resolved,
                 i.detail->>'vessel' AS vessel, i.detail->>'text' AS entry,
                 i.detail->>'reason' AS reason, i.detail->>'ref' AS source_cell
          FROM import_issues i LEFT JOIN berths b ON b.id = i.berth_id
          ORDER BY i.kind, i.year NULLS LAST, i.id`
      : await sql`
          SELECT b.name AS berth, b.length_ft AS berth_ft,
                 COALESCE(v.name, r.title) AS occupant, r.kind, v.length_ft AS vessel_ft,
                 lower(r.during)::text AS start_date, (upper(r.during) - 1)::text AS end_date,
                 (upper(r.during) - lower(r.during))::int AS days,
                 r.status, r.source
          FROM reservations r
          LEFT JOIN vessels v ON v.id = r.vessel_id
          JOIN berths b ON b.id = r.berth_id
          WHERE r.during && daterange(${from}::date, ${to}::date, '[)') AND r.status <> 'cancelled'
          ORDER BY lower(r.during), b.sort_order`

  const cols = rows.length ? Object.keys(rows[0]) : []
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [cols.join(','), ...rows.map((r: any) => cols.map((c) => esc(r[c])).join(','))].join('\n')

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="berth-${what}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
