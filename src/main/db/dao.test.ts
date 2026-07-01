import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openProject, closeProject, getRole } from './connection.js'
import * as dao from './dao.js'
import { assertProtocolEditable, assertHeaderEditable } from './guards.js'
import type { Treatment, Trial, Plot, AssessmentDef } from '@shared/types.js'

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
  dir = mkdtempSync(join(tmpdir(), 'openarm-'))
  openProject(join(dir, 'test.armdb'))
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
})

describe('treatments', () => {
  it('replaces the full treatment list and reads it back ordered by number', () => {
    const list: Treatment[] = [
      { number: 2, name: 'Product B' },
      { number: 1, name: 'Untreated' },
      { number: 3, name: 'Product C' }
    ].map((t) => ({ ...t, product: '', rate: '', rateUnit: '', type: '' }))
    dao.replaceTreatments(list)
    const back = dao.listTreatments()
    expect(back.map((t) => t.number)).toEqual([1, 2, 3])
    expect(back[0].name).toBe('Untreated')
  })
})

describe('trial + plots + assessments', () => {
  function seedTrial(): { headerId: number; plots: Plot[] } {
    dao.replaceTreatments(
      [1, 2, 3].map((n) => ({
        number: n,
        name: `T${n}`,
        product: '',
        rate: '',
        rateUnit: '',
        type: ''
      }))
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
      timing: '14 DA-A',
      ratingDate: '',
      description: 'Control',
      ordinal: 0,
      origin: 'core',
      locked: true,
      analyze: true
    })
    return { headerId, plots: dao.listPlots(trialId) }
  }

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
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[0].id!, value: 12.5 })
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[1].id!, value: 8 })
    let values = dao.listAssessmentValues(plots[0].trialId)
    expect(values).toHaveLength(2)

    // Update existing cell.
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[0].id!, value: 99 })
    values = dao.listAssessmentValues(plots[0].trialId)
    expect(values.find((v) => v.plotId === plots[0].id)!.value).toBe(99)

    // Null clears the cell.
    dao.setAssessmentValue({ assessmentHeaderId: headerId, plotId: plots[0].id!, value: null })
    expect(dao.listAssessmentValues(plots[0].trialId)).toHaveLength(1)
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
      { partRated: 'PLANT', ratingType: 'CONTRO', ratingUnit: '%', timing: '7 DA-A', ratingDate: '', description: 'Control 7', ordinal: 0, analyze: true },
      { partRated: 'PLANT', ratingType: 'NOTE', ratingUnit: '', timing: '', ratingDate: '', description: 'Notes', ordinal: 1, analyze: false }
    ]
    dao.replaceAssessmentDefs(defs)
    const back = dao.listAssessmentDefs()
    expect(back).toHaveLength(2)
    expect(back.map((d) => d.timing)).toEqual(['7 DA-A', ''])
    expect(back.map((d) => d.analyze)).toEqual([true, false]) // analyze flag round-trips
  })
})

describe('protocol → trial', () => {
  /** Author a protocol file at `path` with treatments + one core assessment def. */
  function authorProtocol(path: string): string {
    closeProject()
    openProject(path, { role: 'protocol', create: true })
    dao.saveProtocol({ ...dao.getProtocol(), title: 'Rust Trial', design: 'CRD', replicates: 3 })
    dao.replaceTreatments(
      [1, 2].map((n) => ({ number: n, name: `T${n}`, product: '', rate: '', rateUnit: '', type: '' }))
    )
    dao.replaceAssessmentDefs([
      { partRated: 'PLANT', ratingType: 'CONTRO', ratingUnit: '%', timing: '14 DA-A', ratingDate: '', description: 'Control', ordinal: 0, analyze: false }
    ])
    const uid = dao.getProtocol().protocolUid
    closeProject()
    return uid
  }

  it('copies a protocol into a locked trial file verbatim', () => {
    const uid = authorProtocol(join(dir, 'p.armproto'))
    dao.createTrialFromProtocol(join(dir, 'p.armproto'), join(dir, 't.armtrial'))

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
    authorProtocol(join(dir, 'p.armproto'))
    dao.createTrialFromProtocol(join(dir, 'p.armproto'), join(dir, 't.armtrial'))
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
  })

  it('guards lock protocol + core edits but allow site columns in a trial', () => {
    authorProtocol(join(dir, 'p.armproto'))
    dao.createTrialFromProtocol(join(dir, 'p.armproto'), join(dir, 't.armtrial'))
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
      timing: '',
      ratingDate: '',
      description: 'Site column',
      ordinal: 1,
      origin: 'site',
      locked: false,
      analyze: true
    })
    expect(() => assertHeaderEditable(siteId)).not.toThrow()
  })
})

describe('layout lock + plot exclusion', () => {
  function makeTrial(): number {
    dao.replaceTreatments(
      [1, 2].map((n) => ({ number: n, name: `T${n}`, product: '', rate: '', rateUnit: '', type: '' }))
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
