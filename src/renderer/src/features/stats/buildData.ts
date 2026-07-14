import type { ProjectSnapshot } from '@shared/types'
import { plotValue } from '@shared/derive'

export interface Observation {
  treatment: number
  rep: number
  /** Incomplete block within the replicate (ALPHA); equals rep for complete-block designs. */
  block: number
  value: number
}

/**
 * Assemble long-form observations for one measurement header from the snapshot: one observation per
 * (non-excluded) plot, using the header's derived plot value — the mean of that plot's recorded
 * subsamples for a measured column, or the evaluated formula for a calculated one. Plots whose value
 * is missing (or `null`) are omitted. `treatment` is the treatment *number*.
 */
export function buildObservations(snapshot: ProjectSnapshot, headerId: number): Observation[] {
  const header = snapshot.measurementHeaders.find((h) => h.id === headerId)
  if (!header) return []
  const trtNumberById = new Map(snapshot.treatments.map((t) => [t.id!, t.number]))
  const out: Observation[] = []
  for (const plot of snapshot.plots) {
    if (plot.excluded) continue // excluded plots are omitted from analysis
    const treatment = trtNumberById.get(plot.treatmentId)
    if (treatment === undefined) continue
    const value = plotValue(snapshot, header, plot.id!)
    if (value === null) continue
    out.push({ treatment, rep: plot.rep, block: plot.block, value })
  }
  return out
}
