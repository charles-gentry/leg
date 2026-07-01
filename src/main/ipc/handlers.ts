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
import { assertProtocolEditable, assertRole, assertHeaderEditable } from '../db/guards.js'

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
    dao.saveProtocol(Protocol.parse(p))
    return dao.getProtocol()
  })

  handle(IPC.treatmentsSave, (list: unknown) => {
    assertProtocolEditable()
    const treatments = z.array(Treatment).parse(list)
    dao.replaceTreatments(treatments)
    return dao.listTreatments()
  })

  handle(IPC.applicationsSave, (list: unknown) => {
    assertProtocolEditable()
    const apps = z.array(Application).parse(list)
    dao.replaceApplications(apps)
    return dao.listApplications()
  })

  handle(IPC.assessmentDefSave, (list: unknown) => {
    assertProtocolEditable()
    const defs = z.array(AssessmentDef).parse(list)
    dao.replaceAssessmentDefs(defs)
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
    const cfg = GenerateTrialInput.parse(input)
    const protocol = dao.getProtocol()
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

    const plots: Omit<Plot, 'id' | 'trialId'>[] = randomized.map((rp) => {
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
    const trial: Omit<Trial, 'id'> = { protocolId: 1, plotRows, plotCols, seed, ...site }
    const trialId = dao.replaceTrialWithPlots(trial, plots)
    // Re-materialize the protocol's core assessment columns onto the fresh trial.
    dao.materializeCoreHeaders(trialId)
    return dao.snapshot()
  })

  handle(IPC.plotSwap, (a: unknown, b: unknown) => {
    const plotIdA = z.number().int().parse(a)
    const plotIdB = z.number().int().parse(b)
    dao.swapPlotTreatments(plotIdA, plotIdB)
    return dao.snapshot()
  })

  // --- Assessments ---
  // Add a site-specific column to a trial (forced origin='site', unlocked).
  handle(IPC.assessmentHeaderAddSite, (h: unknown) => {
    assertRole('trial')
    const header = AssessmentHeader.parse(h)
    dao.upsertAssessmentHeader({ ...header, id: undefined, origin: 'site', locked: false })
    const trial = dao.getTrial()
    return trial ? dao.listAssessmentHeaders(trial.id!) : []
  })

  handle(IPC.assessmentHeaderUpsert, (h: unknown) => {
    const header = AssessmentHeader.parse(h)
    if (header.id) assertHeaderEditable(header.id)
    dao.upsertAssessmentHeader(header)
    const trial = dao.getTrial()
    return trial ? dao.listAssessmentHeaders(trial.id!) : []
  })

  handle(IPC.assessmentHeaderDelete, (id: unknown) => {
    const headerId = z.number().int().parse(id)
    assertHeaderEditable(headerId)
    dao.deleteAssessmentHeader(headerId)
    const trial = dao.getTrial()
    return trial ? dao.listAssessmentHeaders(trial.id!) : []
  })

  handle(IPC.assessmentValueSet, (v: unknown) => {
    dao.setAssessmentValue(AssessmentValue.parse(v))
    return true
  })

  // --- Statistics ---
  handle(IPC.statsRunAov, async (headerId: unknown, req: unknown) => {
    const assessmentHeaderId = z.number().int().parse(headerId)
    const aovReq = AovRequest.parse(req)
    const result = await runAov(aovReq)
    dao.saveAnalysisResult(assessmentHeaderId, ENGINE_VERSION, aovReq, result)
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

  // --- Environment ---
  handle(IPC.envDetectR, () => detectR())
  handle(IPC.envSetRscriptPath, (p: unknown) => {
    setRscriptPath(z.string().parse(p))
    return detectR()
  })
}
