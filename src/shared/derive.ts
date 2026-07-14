import type { ProjectSnapshot, MeasurementHeader } from './types.js'
import { parseFormula, evaluate } from './formula.js'

/** A measurement is *calculated* when it carries a non-empty formula (derived, not hand-entered). */
export function isCalculated(h: Pick<MeasurementHeader, 'formula'>): boolean {
  return !!h.formula && h.formula.trim().length > 0
}

/** Headers in data-entry / column-reference order (by ordinal). Column number = index + 1. */
export function orderedHeaders(snapshot: ProjectSnapshot): MeasurementHeader[] {
  return [...snapshot.measurementHeaders].sort((a, b) => a.ordinal - b.ordinal)
}

/**
 * The plot-level value of a measurement:
 *  - measured header → mean of that plot's recorded subsample values (a single value is its own mean);
 *  - calculated header → its formula evaluated against other measurements, where `[n]` is column n's
 *    plot value for the *same* plot and `control([n])` is the untreated-check mean of column n.
 * Missing inputs (and reference cycles) yield `null`.
 */
export function plotValue(
  snapshot: ProjectSnapshot,
  header: MeasurementHeader,
  plotId: number,
  visiting: Set<number> = new Set()
): number | null {
  if (!isCalculated(header)) return measuredMean(snapshot, header.id!, plotId)

  if (visiting.has(header.id!)) return null // reference cycle
  const parsed = parseFormula(header.formula)
  if (!parsed.ok) return null
  const nextVisiting = new Set(visiting).add(header.id!)
  const ordered = orderedHeaders(snapshot)
  const colHeader = (n: number): MeasurementHeader | undefined => ordered[n - 1]

  return evaluate(parsed.ast, {
    plot: (n) => {
      const h = colHeader(n)
      return h ? plotValue(snapshot, h, plotId, nextVisiting) : null
    },
    control: (n) => {
      const h = colHeader(n)
      return h ? controlMean(snapshot, h, nextVisiting) : null
    }
  })
}

/** Mean of a measured header's recorded subsample values for one plot (null if none recorded). */
function measuredMean(snapshot: ProjectSnapshot, headerId: number, plotId: number): number | null {
  let sum = 0
  let count = 0
  for (const v of snapshot.measurementValues) {
    if (v.measurementHeaderId === headerId && v.plotId === plotId && v.value !== null) {
      sum += v.value
      count += 1
    }
  }
  return count ? sum / count : null
}

/** Mean of a column's plot values over the untreated-check plots (non-excluded). Null if no check. */
function controlMean(
  snapshot: ProjectSnapshot,
  header: MeasurementHeader,
  visiting: Set<number>
): number | null {
  const checkTreatmentIds = new Set(
    snapshot.treatments.filter((t) => t.isCheck).map((t) => t.id!)
  )
  if (checkTreatmentIds.size === 0) return null
  let sum = 0
  let count = 0
  for (const p of snapshot.plots) {
    if (p.excluded || !checkTreatmentIds.has(p.treatmentId)) continue
    const v = plotValue(snapshot, header, p.id!, visiting)
    if (v !== null) {
      sum += v
      count += 1
    }
  }
  return count ? sum / count : null
}

/** All plot-level values for a header, keyed by plot id (used by the grid + report). */
export function measurementPlotValues(
  snapshot: ProjectSnapshot,
  header: MeasurementHeader
): Map<number, number | null> {
  const m = new Map<number, number | null>()
  for (const p of snapshot.plots) m.set(p.id!, plotValue(snapshot, header, p.id!))
  return m
}
