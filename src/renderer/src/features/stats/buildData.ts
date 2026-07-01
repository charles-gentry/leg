import type { ProjectSnapshot } from '@shared/types'

export interface Observation {
  treatment: number
  rep: number
  value: number
}

/**
 * Assemble long-form observations for one assessment header from the snapshot,
 * skipping plots with no recorded value. `treatment` is the treatment *number*.
 */
export function buildObservations(snapshot: ProjectSnapshot, headerId: number): Observation[] {
  const plotById = new Map(snapshot.plots.map((p) => [p.id!, p]))
  const trtNumberById = new Map(snapshot.treatments.map((t) => [t.id!, t.number]))
  const out: Observation[] = []
  for (const v of snapshot.assessmentValues) {
    if (v.assessmentHeaderId !== headerId || v.value === null) continue
    const plot = plotById.get(v.plotId)
    if (!plot || plot.excluded) continue // excluded plots are omitted from analysis
    const treatment = trtNumberById.get(plot.treatmentId)
    if (treatment === undefined) continue
    out.push({ treatment, rep: plot.rep, value: v.value })
  }
  return out
}
