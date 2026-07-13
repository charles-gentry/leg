import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openProject, closeProject } from './connection.js'
import { Treatment, AssessmentDef } from '@shared/types.js'
import * as dao from './dao.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'art-lib-travel-'))
})
afterEach(() => {
  closeProject()
  rmSync(dir, { recursive: true, force: true })
})

/** Mirror the handler's syncLibrary() using only the project DB (no personal store). */
function syncSnapshot(): void {
  const refs = dao.collectDocumentTerms()
  dao.replaceLibraryTerms(refs.map((r) => ({ ...r, label: '' })))
}

describe('library snapshot + travel', () => {
  it('collects coded terms from the document and travels them into a trial', () => {
    const proto = join(dir, 'p.artproto')
    openProject(proto, { role: 'protocol', create: true })

    dao.saveProtocol({ ...dao.getProtocol(), crop: 'wheat', targetPest: 'aphid' })
    dao.replaceTreatments([
      Treatment.parse({ number: 1, name: 'A', applications: [{ rateUnit: 'KG/HA' }] })
    ])
    dao.replaceAssessmentDefs([
      AssessmentDef.parse({ partRated: 'PLANT', ratingType: 'yield', ratingUnit: '%', timing: '14 DA-A' })
    ])
    syncSnapshot()

    const got = dao.listLibraryTerms().map((t) => `${t.category}:${t.value}`).sort()
    expect(got).toEqual(
      [
        'crop:wheat',
        'part_rated:PLANT',
        'rating_type:yield',
        'target:aphid',
        'timing:14 DA-A',
        'unit:%',
        'unit:KG/HA'
      ].sort()
    )
    expect(dao.snapshot().libraryTerms).toHaveLength(got.length)
    closeProject()

    // The snapshot travels: a trial created from the protocol carries the same terms.
    dao.createTrialFromProtocol(proto, join(dir, 't.arttrial'))
    const trialTerms = dao.listLibraryTerms().map((t) => `${t.category}:${t.value}`).sort()
    expect(trialTerms).toEqual(got)
  })
})
