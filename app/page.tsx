import { sql } from '@/lib/db'
import Timeline from '@/components/Timeline'
import type { Berth } from '@/components/types'

export const dynamic = 'force-dynamic'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    y?: string; m?: string
    book?: string; berth?: string; start?: string; end?: string; vessel?: string
  }>
}) {
  const sp = await searchParams
  const berths = (await sql`
    SELECT b.id, b.name, b.length_ft, b.notes, b.sort_order,
           count(r.id) FILTER (WHERE r.status = 'active')::int AS active_count
    FROM berths b LEFT JOIN reservations r ON r.berth_id = b.id
    GROUP BY b.id ORDER BY b.sort_order, b.name`) as unknown as Berth[]

  // Open on a month that actually has something in it, so the first screen is
  // the schedule rather than an empty grid.
  const [busiest] = await sql<{ y: number; m: number }[]>`
    SELECT EXTRACT(YEAR FROM lower(during))::int AS y, EXTRACT(MONTH FROM lower(during))::int AS m
    FROM reservations WHERE status <> 'cancelled'
    GROUP BY 1, 2 ORDER BY count(*) DESC, y DESC LIMIT 1`

  const now = new Date()
  const y = Number(sp.y)
  const m = Number(sp.m)
  return (
    <Timeline
      initialBerths={berths}
      initialYear={Number.isFinite(y) && y > 1900 ? y : busiest?.y ?? now.getFullYear()}
      initialMonth={m >= 1 && m <= 12 ? m : busiest?.m ?? now.getMonth() + 1}
      openBooking={
        sp.book === '1' && sp.start && sp.end
          ? {
              berthId: sp.berth ? Number(sp.berth) : null,
              vesselId: sp.vessel ? Number(sp.vessel) : null,
              start: sp.start,
              end: sp.end,
            }
          : null
      }
    />
  )
}
