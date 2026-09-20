import { sql } from '@/lib/db'
import Reference from '@/components/Reference'
import type { Berth } from '@/components/types'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const berths = (await sql`
    SELECT b.id, b.name, b.length_ft, b.notes, b.sort_order,
           count(r.id) FILTER (WHERE r.status = 'active')::int AS active_count
    FROM berths b LEFT JOIN reservations r ON r.berth_id = b.id
    GROUP BY b.id ORDER BY b.sort_order, b.name`) as unknown as Berth[]
  return <Reference initialBerths={berths} />
}
