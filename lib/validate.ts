import { z } from 'zod'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must look like YYYY-MM-DD')

/** Dates are inclusive on the way in (A1) and converted to [start, end+1) below (A2). */
export const reservationInput = z
  .object({
    kind: z.enum(['vessel', 'event']),
    berth_id: z.coerce.number().int().positive(),
    vessel_id: z.coerce.number().int().positive().nullish(),
    title: z.string().trim().min(1).max(200).nullish(),
    start_date: isoDate,
    end_date: isoDate,
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: 'The end date must be on or after the start date.',
    path: ['end_date'],
  })
  .refine((v) => (v.kind === 'vessel' ? v.vessel_id != null : true), {
    message: 'Pick a vessel.', path: ['vessel_id'],
  })
  .refine((v) => (v.kind === 'event' ? !!v.title : true), {
    message: 'Give the event a name.', path: ['title'],
  })

export const reservationPatch = z.object({
  berth_id: z.coerce.number().int().positive().optional(),
  vessel_id: z.coerce.number().int().positive().nullish(),
  title: z.string().trim().max(200).nullish(),
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  status: z.enum(['active', 'cancelled']).optional(),
})

export const berthInput = z.object({
  name: z.string().trim().min(1).max(120),
  length_ft: z.coerce.number().positive().nullish(),
  notes: z.string().trim().max(500).nullish(),
})

export const vesselInput = z.object({
  name: z.string().trim().min(1).max(120),
  length_ft: z.coerce.number().positive().nullish(),
  type: z.string().trim().max(60).nullish(),
})

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Inclusive [start, end] -> half-open [start, end+1) */
export const toRange = (start: string, end: string) => `[${start},${addDays(end, 1)})`

export function zodMessage(e: z.ZodError): string {
  return e.issues[0]?.message ?? 'That request is not valid.'
}
