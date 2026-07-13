import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openProject, closeProject, getRole } from './connection.js'
import * as dao from './dao.js'
import { assertProtocolEditable, assertHeaderEditable } from './guards.js'
import { AssessmentDef } from '@shared/types.js'
import type { Treatment, Trial, Plot } from '@shared/types.js'

/** Empty site metadata for building trial literals in tests. */
const SITE = {
  siteName: '',
  operator: '',
  location: '',
  city: '',
  state: '',
  country: '',
  plantingDate: '',
  trialNotes: ''
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'art-'))
  openProject(join(dir, 'test.artdb'))
})

afterEach(() => {
  closeProject()
  rmSync(dir, { recursive: true, force: true })
})

describe('protocol', () => {
  it('creates a singleton protocol row and round-trips fields', () => {
    const p = dao.getProtocol()
    expect(p.id).toBe(1)
    dao.saveProtocol({ ...p, title: 'Corn Rust Trial', crop: 'Corn' })
    expect(dao.getProtocol().title).toBe('Corn Rust Trial')
    expect(dao.getProtocol().crop).toBe('Corn')
  })

  it('defaults block size and round-trips the ALPHA design + block size', () => {
    expect(dao.getProtocol().blockSize).toBe(2) // schema default
    dao.saveProtocol({ ...dao.getProtocol(), design: 'ALPHA', blockSize: 3 })
    const p = dao.getProtocol()
    expect(p.design).toBe('ALPHA')
    expect(p.blockSize).toBe(3)
  })
})

describe('treatments', () => {
  it('replaces the full treatment list and reads it back ordered by number', () => {
    const list: Treatment[] = [
      { number: 2, name: 'Product B' },
      { number: 1, name: 'Untreated' },
      { number: 3, name: 'Product C' }
    ].map((t) => ({ ...t, type: '', applications: [] }))
    dao.replaceTreatments(list)
    const back = dao.listTreatments()
    expect(back.map((t) => t.number)).toEqual([1, 2, 3])
    expect(back[0].name).toBe('Untreated')
  })
})

describe('trial + plots + assessments', () => {
  function seedTrial(): { headerId: number; plots: Plot[] } {
    dao.replaceTreatments(
      [1, 2, 3].map((n) => ({ number: n, name: `T${n}`, type: '', applications: [] }))
    )
    const treatments = dao.listTreatments()
    dao.saveProtocol({ ...dao.getProtocol(), design: 'RCB', replicates: 2 })
    const trial: Omit<Trial, 'id' | 'layoutLockedAt'> = {
      protocolId: 1,
      plotRows: 2,
      plotCols: 3,
      seed: 42,
      ...SITE
    }
    // 2 reps x 3 treatments = 6 plots, row-major.
    const plots = treatments.flatMap((t, i) =>
      [1, 2].map((rep) => ({
        plotNumber: rep * 10 + i,
        rep,
        treatmentId: t.id!,
        mapRow: rep - 1,
        mapCol: i
      }))
    )
    const trialId = dao.replaceTrialWithPlots(trial, plots)
    const headerId = dao.upsertAssessmentHeader({
      trialId,
      partRated: 'PLANT',
      ratingType: 'CONTRO',
      ratingUnit: '%',
      applicationRef: '',
      daysAfter: null,
      timing: '14 DA-A',
      ratingDate: '',
      description: 'Control',
      ordinal: 0,
      origin: 'core',
      locked: true,
      analyze: true,
      subsamples: 1
    })
    return { headerId, plots: dao.listPlots(trialId) }
  }

  it('defaults plot.block to the rep, and round-trips an explicit incomplete block', () => {
    dao.replaceTreatments(
      [1, 2, 3, 4].map((n) => ({ number: n, name: `T${n}`, type: '', applications: [] }))
    )
    const t = dao.listTreatments()
    // Two treatments per incomplete block (block size 2), one replicate: blocks 1 and 2.
    const trialId = dao.replaceTrialWithPlots(
      { protocolId: 1, plotRows: 2, plotCols: 2, seed: 7, ...SITE },
      [
        { plotNumber: 1, rep: 1, block: 1, treatmentId: t[0].id!, mapRow: 0, mapCol: 0 },
        { plotNumber: 2, rep: 1, block: 1, treatmentId: t[1].id!, mapRow: 0, mapCol: 1 },
        { plotNumber: 3, rep: 1, block: 2, treatmentId: t[2].id!, mapRow: 1, mapCol: 0 },
        // block omitted -> defaults to rep
        { plotNumber: 4, rep: 1, treatmentId: t[3].id!, mapRow: 1, mapCol: 1 }
      ]
    )
    const plots = dao.listPlots(trialId)
    expect(plots.map((p) => p.block)).toEqual([1, 1, 2, 1])
    expect(dao.getPlot(plots[0].id!)!.block).toBe(1)
  })

  it('persists a trial with plots and cascades on replace', () => {
    const { plots } = seedTrial()
    expect(plots).toHaveLength(6)
    // Regenerating replaces the trial (old plots gone).
    dao.replaceTrialWithPlots(
      { protocolId: 1, plotRows: 1, plotCols: 6, seed: 1, ...SITE, siteName: 'Farm B' },
      []
    )
    const trial = dao.getTrial()
    expect(trial?.seed).toBe(1)
    expect(trial?.siteName).toBe('Farm B')
    expect(dao.listPlots(trial!.id!)).toHaveLength(0)
  })

  it('sets, updates, and clears assessment values', () => {
    const { headerId, plots } = seedTrial()
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[0].id!, subsample: 1, value: 12.5 })
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[1].id!, subsample: 1, value: 8 })
    let values = dao.listAssessmentValues(plots[0].trialId)
    expect(values).toHaveLength(2)

    // Update existing cell.
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[0].id!, subsample: 1, value: 99 })
    values = dao.listAssessmentValues(plots[0].trialId)
    expect(values.find((v) => v.plotId === plots[0].id)!.value).toBe(99)

    // Null clears the cell.
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[0].id!, subsample: 1, value: null })
    expect(dao.listAssessmentValues(plots[0].trialId)).toHaveLength(1)
  })

  it('stores subsamples independently per (header, plot, subsample)', () => {
    const { headerId, plots } = seedTrial()
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[0].id!, subsample: 1, value: 4 })
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[0].id!, subsample: 2, value: 6 })
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[0].id!, subsample: 3, value: 8 })
    const forPlot = () =>
      dao.listAssessmentValues(plots[0].trialId).filter((v) => v.plotId === plots[0].id)
    expect(forPlot()).toHaveLength(3)
    expect(forPlot().map((v) => v.value).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([4, 6, 8])

    // Updating one subsample leaves the others intact.
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[0].id!, subsample: 2, value: 60 })
    expect(dao.getAssessmentValue(headerId, plots[0].id!, 2)).toBe(60)
    expect(dao.getAssessmentValue(headerId, plots[0].id!, 1)).toBe(4)

    // Clearing one subsample removes only that row.
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[0].id!, subsample: 3, value: null })
    expect(forPlot()).toHaveLength(2)
  })

  it('swaps treatment assignments between two plots', () => {
    const { plots } = seedTrial()
    const [a, b] = plots
    const beforeA = a.treatmentId
    const beforeB = b.treatmentId
    dao.swapPlotTreatments(a.id!, b.id!)
    const after = dao.listPlots(a.trialId)
    expect(after.find((p) => p.id === a.id)!.treatmentId).toBe(beforeB)
    expect(after.find((p) => p.id === b.id)!.treatmentId).toBe(beforeA)
  })

  it('builds a complete snapshot', () => {
    seedTrial()
    const snap = dao.snapshot()
    expect(snap.treatments).toHaveLength(3)
    expect(snap.plots).toHaveLength(6)
    expect(snap.assessmentHeaders).toHaveLength(1)
    expect(snap.role).toBe('protocol')
    expect(snap.protocol.design).toBe('RCB')
  })
})

describe('assessment definitions', () => {
  it('replaces and lists protocol-owned assessment defs', () => {
    const defs: AssessmentDef[] = [
      { partRated: 'PLANT', ratingType: 'CONTRO', ratingUnit: '%', applicationRef: '', daysAfter: null, timing: '7 DA-A', ratingDate: '', description: 'Control 7', ordinal: 0, analyze: true, subsamples: 5 },
      { partRated: 'PLANT', ratingType: 'NOTE', ratingUnit: '', applicationRef: '', daysAfter: null, timing: '', ratingDate: '', description: 'Notes', ordinal: 1, analyze: false, subsamples: 1 }
    ]
    dao.replaceAssessmentDefs(defs)
    const back = dao.listAssessmentDefs()
    expect(back).toHaveLength(2)
    expect(back.map((d) => d.timing)).toEqual(['7 DA-A', ''])
    expect(back.map((d) => d.analyze)).toEqual([true, false]) // analyze flag round-trips
    expect(back.map((d) => d.subsamples)).toEqual([5, 1]) // subsample count round-trips
  })
})

describe('protocol → trial', () => {
  /** Author a protocol file at `path` with treatments + one core assessment def. */
  function authorProtocol(path: string): string {
    closeProject()
    openProject(path, { role: 'protocol', create: true })
    dao.saveProtocol({ ...dao.getProtocol(), title: 'Rust Trial', design: 'CRD', replicates: 3 })
    dao.replaceTreatments(
      [1, 2].map((n) => ({ number: n, name: `T${n}`, type: '', applications: [] }))
    )
    dao.replaceAssessmentDefs([
      { partRated: 'PLANT', ratingType: 'CONTRO', ratingUnit: '%', applicationRef: '', daysAfter: null, timing: '14 DA-A', ratingDate: '', description: 'Control', ordinal: 0, analyze: false, subsamples: 4 }
    ])
    const uid = dao.getProtocol().protocolUid
    closeProject()
    return uid
  }

  it('copies a protocol into a locked trial file verbatim', () => {
    const uid = authorProtocol(join(dir, 'p.artproto'))
    dao.createTrialFromProtocol(join(dir, 'p.artproto'), join(dir, 't.arttrial'))

    expect(getRole()).toBe('trial')
    const p = dao.getProtocol()
    expect(p.title).toBe('Rust Trial')
    expect(p.design).toBe('CRD')
    expect(p.replicates).toBe(3)
    expect(p.protocolUid).toBe(uid) // identity preserved for matching returned trials
    expect(dao.listTreatments()).toHaveLength(2)
    expect(dao.listAssessmentDefs()).toHaveLength(1)
    expect(dao.getTrial()).toBeNull() // layout not generated yet
  })

  it('materializes locked core headers when the layout is generated', () => {
    authorProtocol(join(dir, 'p.artproto'))
    dao.createTrialFromProtocol(join(dir, 'p.artproto'), join(dir, 't.arttrial'))
    const trialId = dao.replaceTrialWithPlots(
      { protocolId: 1, plotRows: 3, plotCols: 2, seed: 5, ...SITE, siteName: 'Site A' },
      []
    )
    dao.materializeCoreHeaders(trialId)
    const headers = dao.listAssessmentHeaders(trialId)
    expect(headers).toHaveLength(1)
    expect(headers[0].origin).toBe('core')
    expect(headers[0].locked).toBe(true)
    expect(headers[0].analyze).toBe(false) // analyze flag carried from the protocol def
    expect(headers[0].subsamples).toBe(4) // subsample count carried from the protocol def
  })

  it('guards lock protocol + core edits but allow site columns in a trial', () => {
    authorProtocol(join(dir, 'p.artproto'))
    dao.createTrialFromProtocol(join(dir, 'p.artproto'), join(dir, 't.arttrial'))
    const trialId = dao.replaceTrialWithPlots(
      { protocolId: 1, plotRows: 3, plotCols: 2, seed: 5, ...SITE },
      []
    )
    dao.materializeCoreHeaders(trialId)

    expect(() => assertProtocolEditable()).toThrow(/locked/)

    const core = dao.listAssessmentHeaders(trialId)[0]
    expect(() => assertHeaderEditable(core.id!)).toThrow(/protocol/)

    const siteId = dao.upsertAssessmentHeader({
      trialId,
      partRated: '',
      ratingType: 'SITE',
      ratingUnit: '',
      applicationRef: '',
      daysAfter: null,
      timing: '',
      ratingDate: '',
      description: 'Site column',
      ordinal: 1,
      origin: 'site',
      locked: false,
      analyze: true,
      subsamples: 1
    })
    expect(() => assertHeaderEditable(siteId)).not.toThrow()
  })
})

describe('layout lock + plot exclusion', () => {
  function makeTrial(): number {
    dao.replaceTreatments(
      [1, 2].map((n) => ({ number: n, name: `T${n}`, type: '', applications: [] }))
    )
    const t = dao.listTreatments()
    return dao.replaceTrialWithPlots({ protocolId: 1, plotRows: 1, plotCols: 2, seed: 1, ...SITE }, [
      { plotNumber: 1, rep: 1, treatmentId: t[0].id!, mapRow: 0, mapCol: 0 },
      { plotNumber: 2, rep: 1, treatmentId: t[1].id!, mapRow: 0, mapCol: 1 }
    ])
  }

  it('a freshly generated layout is unlocked; lockLayout stamps it', () => {
    makeTrial()
    expect(dao.getTrial()!.layoutLockedAt).toBe('')
    const ts = dao.lockLayout()
    expect(ts).not.toBe('')
    expect(dao.getTrial()!.layoutLockedAt).toBe(ts)
  })

  it('regenerating resets the layout to unlocked', () => {
    makeTrial()
    dao.lockLayout()
    expect(dao.getTrial()!.layoutLockedAt).not.toBe('')
    makeTrial() // replaceTrialWithPlots again
    expect(dao.getTrial()!.layoutLockedAt).toBe('')
  })

  it('setPlotExcluded toggles the flag + reason and clears reason on include', () => {
    makeTrial()
    const p = dao.listPlots(dao.getTrial()!.id!)[0]
    dao.setPlotExcluded(p.id!, true, 'wrong treatment applied')
    expect(dao.getPlot(p.id!)).toMatchObject({ excluded: true, excludeReason: 'wrong treatment applied' })
    dao.setPlotExcluded(p.id!, false, '')
    expect(dao.getPlot(p.id!)).toMatchObject({ excluded: false, excludeReason: '' })
  })
})

describe('applications', () => {
  it('round-trips protocol applications ordered, and travels into a trial', () => {
    const proto = join(dir, 'p.artproto')
    openProject(proto, { role: 'protocol', create: true })
    dao.replaceApplications([
      { ordinal: 0, timingCode: 'A', targetGrowthStage: 'BBCH 30', description: 'first spray' },
      { ordinal: 1, timingCode: 'B', targetGrowthStage: 'BBCH 60', description: 'second spray' }
    ])
    expect(dao.listApplications().map((a) => a.timingCode)).toEqual(['A', 'B'])
    expect(dao.listApplications()[0].targetGrowthStage).toBe('BBCH 30')
    // A treatment is a program: a sequence of application lines, each with its own product/rate/timing.
    dao.replaceTreatments([
      { number: 1, name: 'Untreated', type: '', applications: [] },
      {
        number: 2,
        name: 'Program',
        type: '',
        applications: [
          { ordinal: 0, applicationRef: 'A', product: 'Fungicide X', rate: '1', rateUnit: 'L/HA' },
          { ordinal: 1, applicationRef: 'B', product: 'Fungicide Y', rate: '0.5', rateUnit: 'L/HA' }
        ]
      }
    ])
    const prog = dao.listTreatments()[1]
    expect(prog.applications).toHaveLength(2)
    expect(prog.applications.map((l) => `${l.applicationRef}:${l.product}`)).toEqual([
      'A:Fungicide X',
      'B:Fungicide Y'
    ])
    closeProject()

    dao.createTrialFromProtocol(proto, join(dir, 't.arttrial'))
    expect(dao.listApplications().map((a) => a.timingCode)).toEqual(['A', 'B'])
    // The whole program travels with the treatment.
    expect(dao.listTreatments()[1].applications).toHaveLength(2)
    expect(dao.listTreatments()[1].applications[1].product).toBe('Fungicide Y')
  })

  it('records trial-side application actuals (keyed by timing code)', () => {
    openProject(join(dir, 't.arttrial'), { role: 'trial', create: true })
    dao.replaceApplicationActuals([
      { timingCode: 'A', actualDate: '2026-05-01' },
      { timingCode: 'B', actualDate: '2026-05-20' }
    ])
    const back = dao.listApplicationActuals()
    expect(back).toHaveLength(2)
    expect(back.find((a) => a.timingCode === 'A')?.actualDate).toBe('2026-05-01')
    // Snapshot exposes them.
    expect(dao.snapshot().applicationActuals).toHaveLength(2)
  })

  it('keeps assessment anchor fields (application_ref + days_after) through save/materialize', () => {
    const proto = join(dir, 'p2.artproto')
    openProject(proto, { role: 'protocol', create: true })
    dao.replaceAssessmentDefs([
      AssessmentDef.parse({ ratingType: 'CONTRO', applicationRef: 'A', daysAfter: 14, description: 'Control 14 DA-A' })
    ])
    const def = dao.listAssessmentDefs()[0]
    expect(def.applicationRef).toBe('A')
    expect(def.daysAfter).toBe(14)

    const trialId = dao.replaceTrialWithPlots(
      { protocolId: 1, plotRows: 1, plotCols: 1, seed: 1, ...SITE },
      []
    )
    dao.materializeCoreHeaders(trialId)
    const h = dao.listAssessmentHeaders(trialId)[0]
    expect(h.applicationRef).toBe('A')
    expect(h.daysAfter).toBe(14)
  })
})
