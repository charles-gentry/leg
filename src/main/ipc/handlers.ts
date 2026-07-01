import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { IPC } from '@shared/ipc.js'
import {
  Protocol,
  Treatment,
  Application,
  AssessmentDef,
  AssessmentHeader,
  AssessmentValue,
  AovRequest,
  SiteMetadata,
  type ProjectSnapshot,
  type Trial,
  type Plot
} from '@shared/types.js'
import { z } from 'zod'
import { openProject, closeProject, getCurrentPath } from '../db/connection.js'
import * as dao from '../db/dao.js'
import { recordAudit, listAudit } from '../db/audit.js'
import {
  assertProtocolEditable,
  assertRole,
  assertHeaderEditable,
  assertLayoutLocked,
  assertLayoutUnlocked
} from '../db/guards.js'

const PROTO_FILTER = { name: 'Open ARM Protocol', extensions: ['armproto'] }
const TRIAL_FILTER = { name: 'Open ARM Trial', extensions: ['armtrial'] }
import { detectR } from '../r/detect.js'
import { setRscriptPath } from '../r/run.js'
import { randomize, runAov, ENGINE_VERSION } from '../r/service.js'

/** Wrap a handler so thrown errors become a rejected invoke (surfaced in UI). */
function handle<T>(channel: string, fn: (...args: any[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args))
}

// The design/replicates/plot-dimensions come from the (locked) protocol; a trial
// only chooses its own randomization seed and records its site metadata.
const GenerateTrialInput = SiteMetadata.partial().extend({
  seed: z.number().int().optional()
})

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // --- Documents (role-agnostic) ---
  handle(IPC.projectSnapshot, (): ProjectSnapshot | null => {
    if (!getCurrentPath()) return null
    return dao.snapshot()
  })

  handle(IPC.projectClose, () => {
    closeProject()
    return true
  })

  // --- Protocol authoring ---
  handle(IPC.protocolNew, async (): Promise<ProjectSnapshot | null> => {
    const res = await dialog.showSaveDialog(getWindow()!, {
      title: 'New Protocol',
      defaultPath: 'protocol.armproto',
      filters: [PROTO_FILTER]
    })
    if (res.canceled || !res.filePath) return null
    openProject(res.filePath, { role: 'protocol', create: true })
    recordAudit('protocol.create', 'protocol', 'Created new protocol')
    return dao.snapshot()
  })

  handle(IPC.protocolOpen, async (): Promise<ProjectSnapshot | null> => {
    const res = await dialog.showOpenDialog(getWindow()!, {
      title: 'Open Protocol',
      properties: ['openFile'],
      filters: [PROTO_FILTER]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    openProject(res.filePaths[0])
    return dao.snapshot()
  })

  handle(IPC.protocolSave, (p: unknown) => {
    assertProtocolEditable()
    const next = Protocol.parse(p)
    const prev = dao.getProtocol()
    dao.saveProtocol(next)
    const fields: (keyof Protocol)[] = [
      'title', 'crop', 'targetPest', 'objective', 'investigator', 'season', 'notes',
      'design', 'replicates', 'plotWidth', 'plotLength'
    ]
    const changes: Record<string, { old: unknown; new: unknown }> = {}
    for (const f of fields) if (prev[f] !== next[f]) changes[f] = { old: prev[f], new: next[f] }
    const changed = Object.keys(changes)
    if (changed.length) {
      recordAudit('protocol.edit', 'protocol', `Edited protocol: ${changed.join(', ')}`, { changes })
    }
    return dao.getProtocol()
  })

  handle(IPC.treatmentsSave, (list: unknown) => {
    assertProtocolEditable()
    const treatments = z.array(Treatment).parse(list)
    const before = dao.listTreatments()
    dao.replaceTreatments(treatments)
    recordAudit('treatments.replace', 'treatment', `Updated treatments (${treatments.length})`, {
      before,
      after: dao.listTreatments()
    })
    return dao.listTreatments()
  })

  handle(IPC.applicationsSave, (list: unknown) => {
    assertProtocolEditable()
    const apps = z.array(Application).parse(list)
    const before = dao.listApplications()
    dao.replaceApplications(apps)
    recordAudit('applications.replace', 'application', `Updated applications (${apps.length})`, {
      before,
      after: dao.listApplications()
    })
    return dao.listApplications()
  })

  handle(IPC.assessmentDefSave, (list: unknown) => {
    assertProtocolEditable()
    const defs = z.array(AssessmentDef).parse(list)
    const before = dao.listAssessmentDefs()
    dao.replaceAssessmentDefs(defs)
    recordAudit('assessment.def.replace', 'assessment_def', `Updated core assessments (${defs.length})`, {
      before,
      after: dao.listAssessmentDefs()
    })
    return dao.listAssessmentDefs()
  })

  // --- Trial (created from a protocol) ---
  handle(IPC.trialNewFromProtocol, async (): Promise<ProjectSnapshot | null> => {
    const win = getWindow()!
    const srcRes = await dialog.showOpenDialog(win, {
      title: 'Select Protocol to Implement',
      properties: ['openFile'],
      filters: [PROTO_FILTER]
    })
    if (srcRes.canceled || srcRes.filePaths.length === 0) return null
    const dstRes = await dialog.showSaveDialog(win, {
      title: 'Save New Trial',
      defaultPath: 'trial.armtrial',
      filters: [TRIAL_FILTER]
    })
    if (dstRes.canceled || !dstRes.filePath) return null
    dao.createTrialFromProtocol(srcRes.filePaths[0], dstRes.filePath)
    const p = dao.getProtocol()
    recordAudit(
      'trial.create',
      'trial',
      `Created trial from protocol ${p.protocolUid.slice(0, 8) || '—'} v${p.protocolVersion}`,
      { protocolUid: p.protocolUid, protocolVersion: p.protocolVersion }
    )
    return dao.snapshot()
  })

  handle(IPC.trialOpen, async (): Promise<ProjectSnapshot | null> => {
    const res = await dialog.showOpenDialog(getWindow()!, {
      title: 'Open Trial',
      properties: ['openFile'],
      filters: [TRIAL_FILTER]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    openProject(res.filePaths[0])
    return dao.snapshot()
  })

  // --- Trial generation ---
  handle(IPC.trialGenerate, async (input: unknown): Promise<ProjectSnapshot> => {
    assertRole('trial')
    assertLayoutUnlocked()
    const cfg = GenerateTrialInput.parse(input)
    const protocol = dao.getProtocol()
    const replaced = !!dao.getTrial()
    const treatments = dao.listTreatments()
    if (treatments.length < 2) throw new Error('Add at least 2 treatments before generating a trial.')

    const seed = cfg.seed ?? Math.floor(Math.random() * 1_000_000)
    const randomized = await randomize({
      design: protocol.design,
      treatments: treatments.length,
      replicates: protocol.replicates,
      seed
    })

    // Layout: columns = treatment count, one row per replicate block (row-major).
    const plotCols = treatments.length
    const plotRows = protocol.replicates
    const byNumber = new Map(treatments.map((t) => [t.number, t.id!]))

    const plots: Omit<Plot, 'id' | 'trialId' | 'excluded' | 'excludeReason'>[] = randomized.map((rp) => {
      const treatmentId = byNumber.get(rp.treatment)
      if (treatmentId === undefined) {
        throw new Error(`R returned treatment number ${rp.treatment} with no matching treatment row`)
      }
      return {
        plotNumber: rp.order,
        rep: rp.rep,
        treatmentId,
        mapRow: Math.floor((rp.order - 1) / plotCols),
        mapCol: (rp.order - 1) % plotCols
      }
    })

    const site = SiteMetadata.parse(cfg)
    const trial: Omit<Trial, 'id' | 'layoutLockedAt'> = { protocolId: 1, plotRows, plotCols, seed, ...site }
    const trialId = dao.replaceTrialWithPlots(trial, plots)
    // Re-materialize the protocol's core assessment columns onto the fresh trial.
    dao.materializeCoreHeaders(trialId)
    recordAudit(
      'trial.generate',
      'trial',
      `Generated randomized layout (${protocol.design}, ${protocol.replicates} reps, seed ${seed}) — ${plots.length} plots${replaced ? ' (replaced previous layout + data)' : ''}`,
      { design: protocol.design, replicates: protocol.replicates, seed, plots: plots.length, replaced }
    )
    return dao.snapshot()
  })

  handle(IPC.plotSwap, (a: unknown, b: unknown) => {
    assertLayoutUnlocked()
    const plotIdA = z.number().int().parse(a)
    const plotIdB = z.number().int().parse(b)
    const pa = dao.getPlot(plotIdA)
    const pb = dao.getPlot(plotIdB)
    dao.swapPlotTreatments(plotIdA, plotIdB)
    recordAudit('plot.swap', 'plot', `Swapped treatments: plot #${pa?.plotNumber} ↔ plot #${pb?.plotNumber}`, {
      a: plotIdA,
      b: plotIdB
    })
    return dao.snapshot()
  })

  handle(IPC.trialLockLayout, (): ProjectSnapshot => {
    assertRole('trial')
    const trial = dao.getTrial()
    if (!trial) throw new Error('Generate a layout before locking it.')
    if (trial.layoutLockedAt) throw new Error('The layout is already locked.')
    dao.lockLayout()
    recordAudit('trial.layout.lock', 'trial', 'Locked layout — randomization finalized')
    return dao.snapshot()
  })

  handle(IPC.plotSetExcluded, (input: unknown): ProjectSnapshot => {
    assertRole('trial')
    assertLayoutLocked()
    const { plotId, excluded, reason } = z
      .object({ plotId: z.number().int(), excluded: z.boolean(), reason: z.string().default('') })
      .parse(input)
    const plot = dao.getPlot(plotId)
    dao.setPlotExcluded(plotId, excluded, reason)
    recordAudit(
      excluded ? 'plot.exclude' : 'plot.include',
      'plot',
      excluded
        ? `Excluded plot #${plot?.plotNumber ?? plotId} from analysis — ${reason || '(no reason given)'}`
        : `Restored plot #${plot?.plotNumber ?? plotId} to analysis`,
      { plotId, reason }
    )
    return dao.snapshot()
  })

  // --- Assessments ---
  // Add a site-specific column to a trial (forced origin='site', unlocked).
  handle(IPC.assessmentHeaderAddSite, (h: unknown) => {
    assertRole('trial')
    const header = AssessmentHeader.parse(h)
    dao.upsertAssessmentHeader({ ...header, id: undefined, origin: 'site', locked: false })
    recordAudit(
      'assessment.header.add',
      'assessment_header',
      `Added site assessment "${header.description || header.ratingType || 'assessment'}"`,
      { header }
    )
    const trial = dao.getTrial()
    return trial ? dao.listAssessmentHeaders(trial.id!) : []
  })

  handle(IPC.assessmentHeaderUpsert, (h: unknown) => {
    const header = AssessmentHeader.parse(h)
    if (header.id) assertHeaderEditable(header.id)
    const before = header.id ? dao.getAssessmentHeader(header.id) : null
    dao.upsertAssessmentHeader(header)
    const label = header.description || header.ratingType || 'assessment'
    recordAudit(
      'assessment.header.edit',
      'assessment_header',
      before ? `Edited assessment "${label}"` : `Added assessment "${label}"`,
      { before, after: header }
    )
    const trial = dao.getTrial()
    return trial ? dao.listAssessmentHeaders(trial.id!) : []
  })

  handle(IPC.assessmentHeaderDelete, (id: unknown) => {
    const headerId = z.number().int().parse(id)
    assertHeaderEditable(headerId)
    const before = dao.getAssessmentHeader(headerId)
    dao.deleteAssessmentHeader(headerId)
    recordAudit(
      'assessment.header.delete',
      'assessment_header',
      `Deleted assessment "${before?.description || before?.ratingType || headerId}"`,
      { before }
    )
    const trial = dao.getTrial()
    return trial ? dao.listAssessmentHeaders(trial.id!) : []
  })

  handle(IPC.assessmentValueSet, (v: unknown) => {
    assertLayoutLocked()
    const val = AssessmentValue.parse(v)
    const newVal = val.value === null || Number.isNaN(val.value) ? null : val.value
    const old = dao.getAssessmentValue(val.assessmentHeaderId, val.plotId)
    dao.setAssessmentValue(val)
    if (old !== newVal) {
      const plot = dao.getPlot(val.plotId)
      const header = dao.getAssessmentHeader(val.assessmentHeaderId)
      const fmt = (x: number | null): string => (x === null ? '(empty)' : String(x))
      recordAudit(
        'assessment.value.set',
        'assessment_value',
        `Plot #${plot?.plotNumber ?? '?'} · ${header?.description || 'assessment'} · ${fmt(old)} → ${fmt(newVal)}`,
        { plotId: val.plotId, headerId: val.assessmentHeaderId, old, new: newVal }
      )
    }
    return true
  })

  // --- Statistics ---
  handle(IPC.statsRunAov, async (headerId: unknown, req: unknown) => {
    assertLayoutLocked()
    const assessmentHeaderId = z.number().int().parse(headerId)
    const aovReq = AovRequest.parse(req)
    const result = await runAov(aovReq)
    dao.saveAnalysisResult(assessmentHeaderId, ENGINE_VERSION, aovReq, result)
    const header = dao.getAssessmentHeader(assessmentHeaderId)
    recordAudit(
      'analysis.run',
      'analysis_result',
      `Ran ANOVA on "${header?.description || assessmentHeaderId}" (${aovReq.test}, α=${aovReq.alpha}) — ${result.significant ? 'significant' : 'not significant'}`,
      { test: aovReq.test, alpha: aovReq.alpha, significant: result.significant }
    )
    return result
  })

  // --- Report ---
  handle(IPC.reportExportPdf, async (opts: unknown): Promise<string | null> => {
    const { title } = z.object({ title: z.string().default('') }).parse(opts ?? {})
    const win = getWindow()
    if (!win) throw new Error('No window to export from.')

    const res = await dialog.showSaveDialog(win, {
      title: 'Export Report PDF',
      defaultPath: `${(title || 'trial').replace(/[^\w.-]+/g, '_')}-report.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || !res.filePath) return null

    const esc = (s: string): string =>
      s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    const margin = '<div style="font-size:8px; width:100%; padding:0 12mm; color:#666;">'
    const data = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      margins: { top: 0.7, bottom: 0.7, left: 0.6, right: 0.6 }, // inches; non-zero so templates show
      headerTemplate: `${margin}${esc(title)}</div>`,
      footerTemplate: `${margin.replace('color:#666;', 'color:#666; display:flex; justify-content:space-between;')}<span>Open ARM</span><span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
    })
    await writeFile(res.filePath, data)
    shell.openPath(res.filePath)
    return res.filePath
  })

  // --- Audit ---
  handle(IPC.auditList, () => (getCurrentPath() ? listAudit() : []))

  // --- Environment ---
  handle(IPC.envDetectR, () => detectR())
  handle(IPC.envSetRscriptPath, (p: unknown) => {
    setRscriptPath(z.string().parse(p))
    return detectR()
  })
}
