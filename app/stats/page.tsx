import { sql } from '@/lib/db'
import Stats from '@/components/Stats'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const rows = await sql<{ y: number }[]>`
    SELECT DISTINCT EXTRACT(YEAR FROM lower(during))::int AS y
    FROM reservations WHERE status <> 'cancelled' ORDER BY y DESC`
  const years = rows.map((r) => r.y)
  return <Stats initialYear={years[0] ?? new Date().getFullYear()} years={years} />
}
