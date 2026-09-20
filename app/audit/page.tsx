import { sql } from '@/lib/db'
import Audit from '@/components/Audit'
import type { Berth } from '@/components/types'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const berths = (await sql`
    SELECT id, name, length_ft, notes, sort_order, 0 AS active_count
    FROM berths ORDER BY sort_order, name`) as unknown as Berth[]
  return <Audit berths={berths} />
}
