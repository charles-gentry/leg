import { describe, it, expect } from 'vitest'
import { buildObservations } from './buildData'
import type { ProjectSnapshot } from '@shared/types'

// Minimal snapshot exercising just the fields buildObservations reads.
function snap(): ProjectSnapshot {
  return {
    plots: [
      { id: 1, trialId: 1, plotNumber: 1, rep: 1, treatmentId: 10, mapRow: 0, mapCol: 0, excluded: false, excludeReason: '' },
      { id: 2, trialId: 1, plotNumber: 2, rep: 1, treatmentId: 11, mapRow: 0, mapCol: 1, excluded: true, excludeReason: 'field error' }
    ],
    treatments: [
      { id: 10, number: 1, name: 'A', product: '', rate: '', rateUnit: '', type: '' },
      { id: 11, number: 2, name: 'B', product: '', rate: '', rateUnit: '', type: '' }
    ],
    measurementHeaders: [{ id: 5, ordinal: 0, formula: '' }],
    measurementValues: [
      { measurementHeaderId: 5, plotId: 1, subsample: 1, value: 3 },
      { measurementHeaderId: 5, plotId: 2, subsample: 1, value: 9 }
    ]
  } as unknown as ProjectSnapshot
}

describe('buildObservations', () => {
  it('omits excluded plots from the analysis dataset', () => {
    const obs = buildObservations(snap(), 5)
    expect(obs).toHaveLength(1) // plot 2 is excluded
    expect(obs[0]).toMatchObject({ treatment: 1, value: 3 })
  })

  it('averages subsamples to one observation per plot', () => {
    const s = {
      plots: [
        { id: 1, trialId: 1, plotNumber: 1, rep: 1, treatmentId: 10, mapRow: 0, mapCol: 0, excluded: false, excludeReason: '' },
        { id: 2, trialId: 1, plotNumber: 2, rep: 2, treatmentId: 11, mapRow: 0, mapCol: 1, excluded: false, excludeReason: '' }
      ],
      treatments: [
        { id: 10, number: 1, name: 'A', product: '', rate: '', rateUnit: '', type: '' },
        { id: 11, number: 2, name: 'B', product: '', rate: '', rateUnit: '', type: '' }
      ],
      measurementHeaders: [{ id: 5, ordinal: 0, formula: '' }],
      measurementValues: [
        { measurementHeaderId: 5, plotId: 1, subsample: 1, value: 2 },
        { measurementHeaderId: 5, plotId: 1, subsample: 2, value: 4 },
        { measurementHeaderId: 5, plotId: 1, subsample: 3, value: null }, // nulls ignored
        { measurementHeaderId: 5, plotId: 2, subsample: 1, value: 10 },
        { measurementHeaderId: 5, plotId: 2, subsample: 2, value: 20 }
      ]
    } as unknown as ProjectSnapshot
    const obs = buildObservations(s, 5)
    expect(obs).toHaveLength(2) // one per plot
    expect(obs.find((o) => o.treatment === 1)!.value).toBe(3) // mean(2,4)
    expect(obs.find((o) => o.treatment === 2)!.value).toBe(15) // mean(10,20)
  })
})
