import { sql } from './db'

/**
 * One vessel's full record.
 *
 * Shared by the API route and the page so the page can read the database
 * directly instead of calling its own HTTP endpoint. A server component fetching
 * its own deployment works, but it doubles the latency and depends on the host
 * header being right — which is exactly the kind of thing that behaves
 * differently once it is behind a proxy.
 */
export async function getVessel(vesselId: number) {
  const [vessel] = await sql<any[]>`
    SELECT id, name, length_ft, type, aliases FROM vessels WHERE id = ${vesselId}`
  if (!vessel) return null

  const [stays, issues, summary, berthUse] = await Promise.all([
    sql`
      SELECT r.id, r.kind, r.status, r.source,
             lower(r.during)::text AS start_date, (upper(r.during) - 1)::text AS end_date,
             (upper(r.during) - lower(r.during))::int AS days,
             b.id AS berth_id, b.name AS berth_name, b.length_ft AS berth_length_ft
      FROM reservations r JOIN berths b ON b.id = r.berth_id
      WHERE r.vessel_id = ${vesselId} AND r.status <> 'cancelled'
      ORDER BY lower(r.during)`,
    sql`
      SELECT id, kind, year, detail, resolved FROM import_issues
      WHERE detail->>'vessel' = ${vessel.name}
         OR reservation_id IN (SELECT id FROM reservations WHERE vessel_id = ${vesselId})
      ORDER BY year NULLS LAST, id`,
    sql`
      SELECT count(*)::int AS stays,
             COALESCE(SUM(upper(during) - lower(during)), 0)::int AS total_days,
             min(lower(during))::text AS first_day,
             max(upper(during) - 1)::text AS last_day,
             count(*) FILTER (WHERE status = 'flagged')::int AS flagged
      FROM reservations WHERE vessel_id = ${vesselId} AND status <> 'cancelled'`,
    sql`
      SELECT b.name, b.length_ft, count(*)::int AS n
      FROM reservations r JOIN berths b ON b.id = r.berth_id
      WHERE r.vessel_id = ${vesselId} AND r.status <> 'cancelled'
      GROUP BY b.name, b.length_ft ORDER BY n DESC`,
  ])

  return { vessel, stays, issues, summary: summary[0], berth_use: berthUse }
}
