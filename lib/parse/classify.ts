/**
 * Decides what a single grid cell actually means.
 *
 * Three outcomes, because the legacy grid mixes three different things in the
 * same column of cells:
 *
 *   vessel     — a boat is alongside. Becomes a reservation.
 *   event      — something non-vessel occupies the berth (a sail day, a pier
 *                rebuild). Becomes a reservation with no vessel (A4).
 *   annotation — an operational note about a day ("ETA 1200", "Fueling @0800").
 *                It does NOT occupy the berth, so turning it into a booking
 *                would invent conflicts that never existed. Recorded as an
 *                import issue instead, so nothing is dropped silently.
 */

import { parseVesselName, type VesselName } from './normalize'

export type CellMeaning =
  | { kind: 'vessel'; vessel: VesselName; raw: string }
  | { kind: 'event'; title: string; category: 'event' | 'maintenance'; raw: string }
  | { kind: 'annotation'; reason: string; raw: string }

/** Work that closes a berth: the space is genuinely unavailable. */
const MAINTENANCE = [
  /\bbollard\b/i,
  /\bfloat rebuild\b/i,
  /\bdock maintenance\b/i,
  /\bpier repair\b/i,
  /\bultrasonic\b/i,
  /\bconcrete work\b/i,
  /\butility work\b/i,
  /\bpaving\b/i,
  /\bcrane access\b/i,
  /\bdock inspection\b/i,
  /\bwire spooling\b/i,
  /\bno docking\b/i,
  /\bberth closed\b/i,
  /\bno usage permitted\b/i,
  /\brestricted access\b/i,
]

/** People on the dock: the berth is in use even though no boat is booked. */
const EVENTS = [
  /\bsail day\b/i,
  /\bcampus event\b/i,
  /\bstudent tour\b/i,
  /\bopen house\b/i,
  /\bdonor reception\b/i,
  /\bscience stroll\b/i,
  /\bfilm crew\b/i,
  /\broad race\b/i,
  /\bdive training\b/i,
  /\brescue drill\b/i,
  /\bsafety training\b/i,
  /\bregatta\b/i,
  /\bceremony\b/i,
]

/** Notes about a visit rather than a visit itself. */
const ANNOTATIONS: [RegExp, string][] = [
  [/^\s*\d{3,4}\s*$/, 'bare time'],
  [/\bETA\b/i, 'arrival note'],
  [/\bETD\b/i, 'departure note'],
  [/\barriv(es|al)\b/i, 'arrival note'],
  [/\bdepart(s|ure)\b/i, 'departure note'],
  [/\breturns from\b/i, 'movement note'],
  [/\btouch and go\b/i, 'movement note'],
  [/\bemergency port call\b/i, 'movement note'],
  [/\bdelayed\b/i, 'status note'],
  [/\bfuel(ing)?\b/i, 'service note'],
  [/\bbunker(ing)?\b/i, 'service note'],
  [/\bfuel truck\b/i, 'service note'],
  [/\bslops\b/i, 'service note'],
  [/\bpumping\b/i, 'service note'],
  [/\bprovisioning\b/i, 'service note'],
  [/\bload equipment\b/i, 'service note'],
  [/\bholiday\b/i, 'calendar note'],
]

export function classifyCell(raw: string): CellMeaning | null {
  const s = String(raw).replace(/\s+/g, ' ').trim()
  if (!s) return null

  // A vessel name wins: it is the least ambiguous thing in the sheet.
  const vessel = parseVesselName(s)
  if (vessel) return { kind: 'vessel', vessel, raw: s }

  for (const re of MAINTENANCE) {
    if (re.test(s)) return { kind: 'event', title: s, category: 'maintenance', raw: s }
  }
  for (const re of EVENTS) {
    if (re.test(s)) return { kind: 'event', title: s, category: 'event', raw: s }
  }
  for (const [re, reason] of ANNOTATIONS) {
    if (re.test(s)) return { kind: 'annotation', reason, raw: s }
  }

  // Unrecognised. Treated as an annotation so it lands in the audit for a human
  // to look at, rather than being guessed into a booking.
  return { kind: 'annotation', reason: 'unrecognised entry', raw: s }
}
