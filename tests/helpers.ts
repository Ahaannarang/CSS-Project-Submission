import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://berth:berth@localhost:55432/berth_test'
export const sql = postgres(url, { ssl: false, max: 1, onnotice: () => {} })

export async function resetSchema() {
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await sql.unsafe(readFileSync('sql/001_schema.sql', 'utf8'))
}

export async function truncate() {
  await sql.unsafe('TRUNCATE reservations, import_issues, berths, vessels RESTART IDENTITY CASCADE')
}

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Inclusive dates in, half-open range out (A1 -> A2). */
export const range = (start: string, end: string) => `[${start},${addDays(end, 1)})`

export async function makeBerth(name: string, lengthFt: number | null) {
  const [r] = await sql`INSERT INTO berths (name, length_ft) VALUES (${name}, ${lengthFt}) RETURNING id`
  return r.id as number
}

export async function makeVessel(name: string, lengthFt: number | null) {
  const [r] = await sql`INSERT INTO vessels (name, length_ft) VALUES (${name}, ${lengthFt}) RETURNING id`
  return r.id as number
}

export async function book(opts: {
  berthId: number; vesselId?: number | null; start: string; end: string
  kind?: 'vessel' | 'event'; title?: string | null; status?: 'active' | 'flagged' | 'cancelled'
}) {
  const kind = opts.kind ?? 'vessel'
  const [r] = await sql`
    INSERT INTO reservations (berth_id, vessel_id, kind, title, during, status)
    VALUES (${opts.berthId}, ${kind === 'vessel' ? opts.vesselId! : null}, ${kind},
            ${opts.title ?? null}, ${range(opts.start, opts.end)}::daterange, ${opts.status ?? 'active'})
    RETURNING id`
  return r.id as number
}

/** Runs fn and returns the Postgres error it raised, or null if it succeeded. */
export async function expectFailure(fn: () => Promise<unknown>): Promise<any> {
  try { await fn(); return null } catch (e) { return e }
}
