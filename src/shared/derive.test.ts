import { describe, it, expect } from 'vitest'
import { plotValue, measurementPlotValues, isCalculated } from './derive.js'
import type {
  ProjectSnapshot,
  MeasurementHeader,
  MeasurementValue,
  Treatment,
  Plot
} from './types.js'

// --- minimal snapshot builder ---------------------------------------------

function header(id: number, ordinal: number, formula = ''): MeasurementHeader {
  return {
    id,
    trialId: 1,
    partMeasured: '',
    measurementType: `m${id}`,
    measurementUnit: '',
    applicationRef: '',
    daysAfter: null,
    timing: '',
    description: `Col ${ordinal + 1}`,
    ordinal,
    origin: 'core',
    locked: true,
    analyze: true,
    subsamples: 1,
    formula,
    measurementDate: '',
    assessedBy: '',
    growthStage: ''
  }
}

function treatment(id: number, number: number, isCheck = false): Treatment {
  return { id, number, name: `T${number}`, type: '', isCheck, applications: [] }
}

function plot(id: number, treatmentId: number, excluded = false): Plot {
  return {
    id,
    trialId: 1,
    plotNumber: id,
    rep: 1,
    block: 1,
    treatmentId,
    mapRow: 0,
    mapCol: id,
    excluded,
    excludeReason: ''
  }
}

function val(headerId: number, plotId: number, value: number, subsample = 1): MeasurementValue {
  return { measurementHeaderId: headerId, plotId, subsample, value }
}

function snap(partial: Partial<ProjectSnapshot>): ProjectSnapshot {
  return {
    filePath: '',
    role: 'trial',
    protocol: {} as ProjectSnapshot['protocol'],
    treatments: [],
    applications: [],
    measurementDefs: [],
    trial: null,
    plots: [],
    measurementHeaders: [],
    measurementValues: [],
    applicationActuals: [],
    properties: [],
    libraryTerms: [],
    ...partial
  }
}

describe('derive.plotValue', () => {
  it('averages a measured header’s subsamples', () => {
    const h = header(1, 0)
    const s = snap({
      plots: [plot(10, 1)],
      measurementHeaders: [h],
      measurementValues: [val(1, 10, 4), val(1, 10, 6)]
    })
    expect(plotValue(s, h, 10)).toBe(5)
  })

  it('evaluates a calculated header per plot (mean of two columns)', () => {
    const h1 = header(1, 0)
    const h2 = header(2, 1)
    const calc = header(3, 2, '([1] + [2]) / 2')
    const s = snap({
      plots: [plot(10, 1)],
      measurementHeaders: [h1, h2, calc],
      measurementValues: [val(1, 10, 10), val(2, 10, 30)]
    })
    expect(plotValue(s, calc, 10)).toBe(20)
  })

  it('computes % of untreated control (abbott)', () => {
    const h1 = header(1, 0)
    const calc = header(2, 1, 'abbott([1])')
    const s = snap({
      treatments: [treatment(1, 1, true), treatment(2, 2)], // T1 is the untreated check
      plots: [plot(10, 1), plot(11, 1), plot(12, 2)],
      measurementHeaders: [h1, calc],
      // check mean of col1 = mean(100, 100) = 100; treated plot 12 = 40 -> 60% control
      measurementValues: [val(1, 10, 100), val(1, 11, 100), val(1, 12, 40)]
    })
    expect(plotValue(s, calc, 12)).toBe(60)
  })

  it('yields null for a reference cycle', () => {
    const a = header(1, 0, '[2] + 1')
    const b = header(2, 1, '[1] + 1')
    const s = snap({ plots: [plot(10, 1)], measurementHeaders: [a, b] })
    expect(plotValue(s, a, 10)).toBeNull()
  })

  it('measurementPlotValues maps every plot, null when inputs missing', () => {
    const h1 = header(1, 0)
    const calc = header(2, 1, '[1] * 2')
    const s = snap({
      plots: [plot(10, 1), plot(11, 1)],
      measurementHeaders: [h1, calc],
      measurementValues: [val(1, 10, 7)] // plot 11 has no value
    })
    const m = measurementPlotValues(s, calc)
    expect(m.get(10)).toBe(14)
    expect(m.get(11)).toBeNull()
  })

  it('isCalculated reflects a non-empty formula', () => {
    expect(isCalculated({ formula: '' })).toBe(false)
    expect(isCalculated({ formula: '[1]+1' })).toBe(true)
  })
})
