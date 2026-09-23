import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * FR12: utilisation.
 *
 * Occupancy is measured in berth-days: the days of a stay that fall inside the
 * window, divided by the days in the window. Stays that straddle a boundary are
 * clipped rather than counted twice, so the yearly figures actually add up.
 */
export async function GET(req: NextRequest) {
  // ?span=all returns the whole record as a year x month grid, which is what the
  // heatmap draws. It is one pass over the reservations rather than 23 queries.
  if (req.nextUrl.searchParams.get('span') === 'all') {
    const [grid, berthCount] = await Promise.all([
      sql`
        SELECT EXTRACT(YEAR  FROM d)::int AS year,
               EXTRACT(MONTH FROM d)::int AS month,
               count(*)::int AS berth_days,
               count(DISTINCT r.berth_id)::int AS berths_used
        FROM reservations r,
             generate_series(lower(r.during), upper(r.during) - 1, interval '1 day') d
        WHERE r.status = 'active'
        GROUP BY 1, 2 ORDER BY 1, 2`,
      sql`SELECT count(*)::int AS n FROM berths`,
    ])
    return NextResponse.json({ grid, berth_count: berthCount[0].n })
  }

  // make_date() raises outside a sane range, so clamp rather than 500.
  const requested = Number(req.nextUrl.searchParams.get('year') ?? new Date().getFullYear())
  const year = Number.isInteger(requested) && requested >= 1900 && requested <= 2200
    ? requested
    : new Date().getFullYear()
  const from = `${year}-01-01`
  const to = `${year + 1}-01-01`

  const [perBerth, perMonth, busiest, span] = await Promise.all([
    // The CASE is load-bearing. LEAST and GREATEST IGNORE nulls in Postgres, so
    // for a berth the LEFT JOIN found nothing for, LEAST(upper(NULL), to) is
    // just `to` and GREATEST(lower(NULL), from) is `from` — which made every
    // unused berth report the whole window as occupied, i.e. 100%.
    sql`
      SELECT b.id, b.name, b.length_ft,
             COALESCE(SUM(
               CASE WHEN r.id IS NULL THEN 0
                    ELSE GREATEST(0, LEAST(upper(r.during), ${to}::date) - GREATEST(lower(r.during), ${from}::date))
               END
             ), 0)::int AS occupied_days,
             (${to}::date - ${from}::date) AS window_days
      FROM berths b
      LEFT JOIN reservations r ON r.berth_id = b.id AND r.status = 'active'
                              AND r.during && daterange(${from}::date, ${to}::date, '[)')
      GROUP BY b.id ORDER BY b.sort_order, b.name`,
    sql`
      SELECT m.month::int AS month,
             COALESCE(SUM(
               CASE WHEN r.id IS NULL THEN 0
                    ELSE GREATEST(0, LEAST(upper(r.during), (m.month_start + interval '1 month')::date)
                                   - GREATEST(lower(r.during), m.month_start))
               END
             ), 0)::int AS occupied_days,
             (SELECT count(*)::int FROM berths) *
               EXTRACT(DAY FROM (m.month_start + interval '1 month' - interval '1 day'))::int AS capacity_days
      FROM (
        SELECT generate_series(1, 12) AS month,
               make_date(${year}, generate_series(1, 12), 1) AS month_start
      ) m
      LEFT JOIN reservations r ON r.status = 'active'
        AND r.during && daterange(m.month_start, (m.month_start + interval '1 month')::date, '[)')
      GROUP BY m.month, m.month_start ORDER BY m.month`,
    sql`
      SELECT EXTRACT(MONTH FROM d)::int AS month, count(*)::int AS berth_days
      FROM reservations r, generate_series(lower(r.during), upper(r.during) - 1, interval '1 day') d
      WHERE r.status = 'active'
      GROUP BY 1 ORDER BY berth_days DESC LIMIT 3`,
    sql`SELECT min(lower(during))::text AS first_day, max(upper(during) - 1)::text AS last_day,
               count(*)::int AS total, count(*) FILTER (WHERE status = 'flagged')::int AS flagged
        FROM reservations WHERE status <> 'cancelled'`,
  ])

  return NextResponse.json({ year, per_berth: perBerth, per_month: perMonth, busiest_months: busiest, span: span[0] })
}
