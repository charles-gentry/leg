import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openProject, closeProject } from './connection.js'
import * as dao from './dao.js'
import { recordAudit, listAudit } from './audit.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'art-audit-'))
  openProject(join(dir, 'test.artproto'), { role: 'protocol', create: true })
})

afterEach(() => {
  closeProject()
  rmSync(dir, { recursive: true, force: true })
})

describe('audit trail', () => {
  it('records entries and lists them newest-first with parsed detail + actor', () => {
    recordAudit('protocol.edit', 'protocol', 'Edited protocol: title', {
      changes: { title: { old: '', new: 'Rust' } }
    })
    recordAudit('treatments.replace', 'treatment', 'Updated treatments (2)')

    const log = listAudit()
    expect(log).toHaveLength(2)
    // Newest first.
    expect(log[0].action).toBe('treatments.replace')
    expect(log[1].action).toBe('protocol.edit')
    // Actor is populated from the OS account (non-empty).
    expect(log[0].actor.length).toBeGreaterThan(0)
    expect(log[0].role).toBe('protocol')
    // Detail is parsed back into an object.
    expect((log[1].detail.changes as Record<string, unknown>).title).toEqual({ old: '', new: 'Rust' })
  })

  it('getMeasurementValue returns the prior value then the updated one', () => {
    // Minimal trial + plot + header to attach a value to.
    dao.replaceTreatments([
      { number: 1, name: 'A', type: '', isCheck: false, applications: [] },
      { number: 2, name: 'B', type: '', isCheck: false, applications: [] }
    ])
    const t = dao.listTreatments()
    const trialId = dao.replaceTrialWithPlots(
      {
        protocolId: 1,
        plotRows: 1,
        plotCols: 2,
        seed: 1,
        siteName: '',
        operator: '',
        location: '',
        city: '',
        state: '',
        country: '',
        plantingDate: '',
        trialNotes: ''
      },
      [{ plotNumber: 1, rep: 1, treatmentId: t[0].id!, mapRow: 0, mapCol: 0 }]
    )
    const headerId = dao.upsertMeasurementHeader({
      trialId,
      partMeasured: '',
      measurementType: 'CONTRO',
      measurementUnit: '%',
      applicationRef: '',
      daysAfter: null,
      timing: '',
      formula: '', growthStage: '',
      measurementDate: '',
      assessedBy: '',
      description: 'Control',
      ordinal: 0,
      origin: 'core',
      locked: true,
      analyze: true,
      subsamples: 1
    })
    const plotId = dao.listPlots(trialId)[0].id!

    expect(dao.getMeasurementValue(headerId, plotId, 1)).toBeNull()
    dao.setMeasurementValue({ measurementHeaderId: headerId, plotId, subsample: 1, value: 42 })
    expect(dao.getMeasurementValue(headerId, plotId, 1)).toBe(42)
  })
})
