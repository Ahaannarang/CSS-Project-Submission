/**
 * Name and text normalisation for the legacy workbook.
 *
 * The sheets were maintained by hand for 23 years, so the same vessel shows up
 * as "Barge SALT DORY", "Barge Salt Dory" and "Barge  Salt  Dory". Lengths are
 * baked into the name on the reference tabs ("R/V High Drift 120'") but never
 * in the schedule grid. Everything here is about collapsing those variants onto
 * one key without losing the spelling a human would recognise.
 */

/** Vessel prefixes seen in the workbook, longest first so OS/V beats OSV. */
const PREFIXES = ['OS/V', 'OSV', 'R/V', 'M/V', 'M/Y', 'S/V', 'S/Y', 'F/V', 'Tug', 'Barge']

/** OS/V and OSV are the same designation; fold them together. */
const PREFIX_CANON: Record<string, string> = { 'OS/V': 'OSV' }

export type VesselName = {
  /** Display form, title-cased body with the original prefix: "Barge Salt Dory" */
  display: string
  /** Match key, lowercase and punctuation-free: "osv salt dory" */
  key: string
  prefix: string
  /** Length parsed off the end of the name, if it carried one. */
  lengthFt: number | null
}

/** Pulls `120'` / `120 ft` / `LOA: 120'` out of a string. */
export function extractLengthFt(raw: string): number | null {
  const loa = raw.match(/LOA:?\s*(\d{1,4}(?:\.\d+)?)\s*(?:'|ft\b|feet\b)/i)
  if (loa) return Number(loa[1])
  const trailing = raw.match(/(\d{1,4}(?:\.\d+)?)\s*(?:'|ft\b|feet\b)\s*$/i)
  if (trailing) return Number(trailing[1])
  const metres = raw.match(/(\d{1,4}(?:\.\d+)?)\s*(?:m\b|metres\b|meters\b)/i)
  if (metres) return Math.round(Number(metres[1]) * 3.28084 * 10) / 10   // A6
  return null
}

/**
 * Parses a cell that is believed to name a vessel.
 * Returns null when the text does not look like a vessel at all.
 */
export function parseVesselName(raw: string): VesselName | null {
  let s = String(raw).replace(/\s+/g, ' ').trim()
  if (!s) return null

  const lengthFt = extractLengthFt(s)

  // Strip a trailing length and anything after it ("M/Y Wild Tern 145'", "R/V X 52' (spare)")
  s = s.replace(/\s*\b\d{1,4}(?:\.\d+)?\s*(?:'|ft\b|feet\b|m\b).*$/i, '').trim()
  s = s.replace(/[,;:]\s*$/, '').trim()

  const prefix = PREFIXES.find((p) => s.toUpperCase().startsWith(p.toUpperCase() + ' '))
  if (!prefix) return null

  const body = s.slice(prefix.length).trim()
  if (!body || !/[A-Za-z]/.test(body)) return null

  const canonPrefix = PREFIX_CANON[prefix.toUpperCase()] ?? prefix.toUpperCase()
  const display =
    (PREFIX_CANON[prefix.toUpperCase()] ?? prefix.toUpperCase().replace('TUG', 'Tug').replace('BARGE', 'Barge')) +
    ' ' +
    titleCase(body)

  return {
    display,
    key: (canonPrefix + ' ' + body).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(),
    prefix: canonPrefix,
    lengthFt,
  }
}

/** "SALT DORY" and "salt dory" both become "Salt Dory". */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** Berth row labels look like "North Pier West - 410'" or "North Finger Piers:". */
export function parseBerthLabel(raw: string): { name: string; lengthFt: number | null } | null {
  const s = String(raw).replace(/\s+/g, ' ').trim()
  if (!s) return null
  const lengthFt = extractLengthFt(s)
  const name = s
    .replace(/\s*[-–]\s*\d{1,4}(?:\.\d+)?\s*(?:'|ft\b).*$/i, '')
    .replace(/:\s*$/, '')
    .trim()
  if (!name) return null
  return { name, lengthFt }
}

export function berthKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}
