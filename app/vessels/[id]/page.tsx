import { notFound } from 'next/navigation'
import { getVessel } from '@/lib/vessel'
import VesselDetail from '@/components/VesselDetail'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getVessel(Number(id))
  if (!data) notFound()
  return <VesselDetail data={data} />
}
