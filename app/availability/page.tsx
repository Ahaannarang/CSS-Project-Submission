import { sql } from '@/lib/db'
import Availability from '@/components/Availability'
import type { Vessel } from '@/components/types'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const vessels = (await sql`
    SELECT id, name, length_ft, type, 0 AS booking_count
    FROM vessels WHERE length_ft IS NOT NULL ORDER BY name`) as unknown as Vessel[]
  return <Availability vessels={vessels} />
}
