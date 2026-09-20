/** All display dates are plain calendar days in the facility's own time zone (A9). */
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export const weekdayOf = (isoDate: string) => new Date(isoDate + 'T00:00:00Z').getUTCDay()

export const addDays = (isoDate: string, n: number) => {
  const d = new Date(isoDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const diffDays = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)

export const fmtDay = (isoDate: string) =>
  new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export const fmtFull = (isoDate: string) =>
  new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export const ft = (v: string | number | null | undefined) =>
  v == null ? '—' : `${Number(v)} ft`
