export type Reservation = {
  id: number
  berth_id: number
  vessel_id: number | null
  kind: 'vessel' | 'event'
  title: string | null
  status: 'active' | 'cancelled' | 'flagged'
  source: 'manual' | 'legacy_import'
  start_date: string
  end_date: string
  days: number
  vessel_name: string | null
  vessel_length_ft: string | null
  berth_name: string
  berth_length_ft: string | null
}

export type Berth = {
  id: number
  name: string
  length_ft: string | null
  notes: string | null
  sort_order: number
  active_count: number
}

export type Vessel = {
  id: number
  name: string
  length_ft: string | null
  type: string | null
  booking_count: number
}

export type Suggestion = {
  berth_id: number
  name: string
  length_ft: number | null
  slack_ft: number | null
  label: string
  reason: string
}

export type Alternative = {
  berth_id: number
  name: string
  length_ft: number | null
  kind: 'shifted_dates' | 'frees_up'
  start_date?: string
  end_date?: string
  free_from?: string
  reason: string
}
