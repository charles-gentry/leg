import type { AssessmentDef, ApplicationActual } from './types.js'

/**
 * Assessment timing is anchored to an application: an assessment references an application's timing
 * code and an offset in days, so its schedule reads "N DA-<code>" (e.g. "14 DA-A"). The free-text
 * `timing` field is an optional manual override that wins when set. The actual calendar date is
 * derived from the trial-side actual application date + the offset.
 */

/**
 * The human-readable timing label: the free-text override if set, else the derived
 * "N DA-<code>" (days after), "N DB-<code>" (days before), or "AT-<code>" (day of).
 */
export function timingLabel(
  a: Pick<AssessmentDef, 'applicationRef' | 'daysAfter' | 'timing'>
): string {
  if (a.timing && a.timing.trim()) return a.timing.trim()
  if (a.applicationRef && a.daysAfter != null) {
    const n = a.daysAfter
    if (n === 0) return `AT-${a.applicationRef}`
    return `${Math.abs(n)} ${n > 0 ? 'DA' : 'DB'}-${a.applicationRef}`
  }
  return ''
}

/** Add `daysAfter` to an ISO date (YYYY-MM-DD); '' when the base date is missing/invalid. */
export function addDays(isoDate: string, daysAfter: number): string {
  if (!isoDate) return ''
  const d = new Date(isoDate + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + daysAfter)
  return d.toISOString().slice(0, 10)
}

/**
 * The assessment's calendar date, derived from the anchored application's actual date + the offset.
 * Returns '' when unanchored or the application has no recorded actual date.
 */
export function assessmentDate(
  a: Pick<AssessmentDef, 'applicationRef' | 'daysAfter'>,
  actuals: ApplicationActual[]
): string {
  if (!a.applicationRef || a.daysAfter == null) return ''
  const actual = actuals.find((x) => x.timingCode === a.applicationRef)?.actualDate
  return actual ? addDays(actual, a.daysAfter) : ''
}
