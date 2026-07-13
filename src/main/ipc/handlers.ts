import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { writeFile, readFile } from 'fs/promises'
import { IPC } from '@shared/ipc.js'
import {
  Protocol,
  Treatment,
  Application,
  ApplicationActual,
  Property,
  PropertyScope,
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
import { validateDesign, canSwapTreatments, defaultCols } from '@shared/design.js'
import { LibraryCategory, type LibraryExport } from '@shared/types.js'
import * as library from '../library/store.js'
import { openProject, closeProject, getCurrentPath } from '../db/connection.js'
import { setMenuEnabled } from '../menu.js'
import * as dao from '../db/dao.js'
import { recordAudit, listAudit } from '../db/audit.js'
import {
  assertProtocolEditable,
  assertRole,
  assertHeaderEditable,
  assertLayoutLocked,
  assertLayoutUnlocked
} from '../db/guards.js'

const PROTO_FILTER = { name: 'ART Protocol', extensions: ['artproto'] }
const TRIAL_FILTER = { name: 'ART Trial', extensions: ['arttrial'] }
import { detectR } from '../r/detect.js'
import { setRscriptPath } from '../r/run.js'
import { randomize, runAov, ENGINE_VERSION } from '../r/service.js'

/** Wrap a handler so thrown errors become a rejected invoke (surfaced in UI). */
function handle<T>(channel: string, fn: (...args: any[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args))
}

/**
 * Sync the library after a coded field changed: record newly-referenced terms into the author's
 * personal library (once per document, scoped to the current crop) and rebuild the document's
 * travelling snapshot from all its current coded fields.
 */
function syncLibrary(): void {
  if (!getCurrentPath()) return
  const before = dao.listLibraryTerms()
  const refs = dao.collectDocumentTerms()
  const crop = dao.getProtocol().crop
  const added = refs.filter((r) => !before.some((b) => b.category === r.category && b.value === r.value))
  if (library.isOpen()) {
    library.recordUsage(added, crop)
    dao.replaceLibraryTerms(refs.map((r) => ({ ...r, label: library.labelFor(r.category, r.value) })))
  } else {
    dao.replaceLibraryTerms(refs.map((r) => ({ ...r, label: '' })))
  }
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
      defaultPath: 'protocol.artproto',
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
      'design', 'replicates', 'blockSize', 'plotWidth', 'plotLength'
    ]
    const changes: Record<string, { old: unknown; new: unknown }> = {}
    for (const f of fields) if (prev[f] !== next[f]) changes[f] = { old: prev[f], new: next[f] }
    const changed = Object.keys(changes)
    if (changed.length) {
      recordAudit('protocol.edit', 'protocol', `Edited protocol: ${changed.join(', ')}`, { changes })
    }
    syncLibrary()
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
    syncLibrary()
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
    syncLibrary()
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
    syncLibrary()
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
    // Refuse a non-conformant protocol before creating a trial the operator can't randomize.
    const info = dao.readDesignInfo(srcRes.filePaths[0])
    const v = validateDesign(info.design, info.replicates, info.blockSize, info.treatmentCount)
    if (!v.ok) throw new Error(`This protocol's design cannot be randomized: ${v.error}`)
    const dstRes = await dialog.showSaveDialog(win, {
      title: 'Save New Trial',
      defaultPath: 'trial.arttrial',
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

  // Create a trial from the protocol that is currently open — no need to re-pick the file.
  handle(IPC.trialNewFromCurrent, async (): Promise<ProjectSnapshot | null> => {
    assertRole('protocol')
    const src = getCurrentPath()
    if (!src) throw new Error('No protocol is open.')
    // Block creating a trial from a non-conformant design (caught at authoring, not by the operator).
    const proto = dao.getProtocol()
    const v = validateDesign(proto.design, proto.replicates, proto.blockSize, dao.listTreatments().length)
    if (!v.ok) throw new Error(v.error)
    const dstRes = await dialog.showSaveDialog(getWindow()!, {
      title: 'Save New Trial',
      defaultPath: 'trial.arttrial',
      filters: [TRIAL_FILTER]
    })
    if (dstRes.canceled || !dstRes.filePath) return null
    // Release the protocol's write handle (flushing WAL) before copying it read-only.
    closeProject()
    dao.createTrialFromProtocol(src, dstRes.filePath)
    const p = dao.getProtocol()
    recordAudit(
      'trial.create',
      'trial',
      `Created trial from protocol ${p.protocolUid.slice(0, 8) || '—'} v${p.protocolVersion}`,
      { protocolUid: p.protocolUid, protocolVersion: p.protocolVersion, from: 'current' }
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
    // Final backstop for design conformance (the same check runs at authoring + trial creation).
    const conformance = validateDesign(
      protocol.design,
      protocol.replicates,
      protocol.blockSize,
      treatments.length
    )
    if (!conformance.ok) throw new Error(conformance.error)

    const seed = cfg.seed ?? Math.floor(Math.random() * 1_000_000)
    const randomized = await randomize({
      design: protocol.design,
      treatments: treatments.length,
      replicates: protocol.replicates,
      blockSize: protocol.design === 'ALPHA' ? protocol.blockSize : undefined,
      seed
    })

    // Layout: RCB/CRD lay out one full replicate per row (columns = treatments). ALPHA
    // lays out one incomplete block per row (columns = block size k).
    const plotCols = defaultCols(protocol.design, protocol.blockSize, treatments.length)
    const plotRows = Math.ceil(randomized.length / plotCols)
    const byNumber = new Map(treatments.map((t) => [t.number, t.id!]))

    const plots: Omit<Plot, 'id' | 'trialId' | 'excluded' | 'excludeReason'>[] = randomized.map((rp) => {
      const treatmentId = byNumber.get(rp.treatment)
      if (treatmentId === undefined) {
        throw new Error(`R returned treatment number ${rp.treatment} with no matching treatment row`)
      }
      return {
        plotNumber: rp.order,
        rep: rp.rep,
        block: rp.block,
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
    const blockNote = protocol.design === 'ALPHA' ? `, block size ${protocol.blockSize}` : ''
    recordAudit(
      'trial.generate',
      'trial',
      `Generated randomized layout (${protocol.design}, ${protocol.replicates} reps${blockNote}, seed ${seed}) — ${plots.length} plots${replaced ? ' (replaced previous layout + data)' : ''}`,
      {
        design: protocol.design,
        replicates: protocol.replicates,
        ...(protocol.design === 'ALPHA' ? { blockSize: protocol.blockSize } : {}),
        seed,
        plots: plots.length,
        replaced
      }
    )
    return dao.snapshot()
  })

  handle(IPC.plotSwap, (a: unknown, b: unknown) => {
    assertLayoutUnlocked()
    const plotIdA = z.number().int().parse(a)
    const plotIdB = z.number().int().parse(b)
    const pa = dao.getPlot(plotIdA)
    const pb = dao.getPlot(plotIdB)
    if (!pa || !pb) throw new Error('Plot not found for swap.')
    // Only allow analysis-neutral treatment swaps (same block/rep, per the design).
    if (!canSwapTreatments(dao.getProtocol().design, pa, pb)) {
      throw new Error(
        'Treatments can only be swapped within the same block/rep — swapping across blocks would change the design and invalidate the analysis.'
      )
    }
    dao.swapPlotTreatments(plotIdA, plotIdB)
    recordAudit('plot.swap', 'plot', `Swapped treatments: plot #${pa.plotNumber} ↔ plot #${pb.plotNumber}`, {
      a: plotIdA,
      b: plotIdB
    })
    return dao.snapshot()
  })

  handle(IPC.plotMove, (input: unknown): ProjectSnapshot => {
    assertRole('trial')
    assertLayoutUnlocked()
    const { plotId, mapRow, mapCol } = z
      .object({ plotId: z.number().int(), mapRow: z.number().int().min(0), mapCol: z.number().int().min(0) })
      .parse(input)
    const p = dao.getPlot(plotId)
    dao.movePlotToCell(plotId, mapRow, mapCol)
    recordAudit('plot.move', 'plot', `Moved plot #${p?.plotNumber} to r${mapRow}c${mapCol}`, {
      plotId,
      mapRow,
      mapCol
    })
    return dao.snapshot()
  })

  handle(IPC.layoutReshape, (cols: unknown): ProjectSnapshot => {
    assertRole('trial')
    assertLayoutUnlocked()
    const n = z.number().int().min(1).parse(cols)
    dao.reshapeLayout(n)
    recordAudit('layout.reshape', 'trial', `Reshaped layout to ${n} columns`, { cols: n })
    return dao.snapshot()
  })

  handle(IPC.applicationActualsSave, (list: unknown): ProjectSnapshot => {
    assertRole('trial')
    const actuals = z.array(ApplicationActual).parse(list)
    dao.replaceApplicationActuals(actuals)
    recordAudit('application.actuals', 'application_actual', `Recorded ${actuals.length} application date(s)`, {
      actuals
    })
    return dao.snapshot()
  })

  handle(IPC.propertiesSave, (input: unknown): ProjectSnapshot => {
    assertRole('trial')
    const { scope, scopeRef, props } = z
      .object({ scope: PropertyScope, scopeRef: z.string().default(''), props: z.array(Property) })
      .parse(input)
    dao.replaceProperties(scope, scopeRef, props)
    recordAudit('properties.save', 'property', `Updated ${scope} properties (${props.length})`, {
      scope,
      scopeRef,
      props
    })
    syncLibrary() // record new property keys into the personal library
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
    syncLibrary()
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
    syncLibrary()
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
    syncLibrary()
    const trial = dao.getTrial()
    return trial ? dao.listAssessmentHeaders(trial.id!) : []
  })

  // Event metadata (date assessed / assessor / growth stage) is recorded at data entry,
  // so it stays editable even after the assessment definition is locked.
  handle(IPC.assessmentMetadataSave, (payload: unknown) => {
    const { id, ratingDate, assessedBy, growthStage } = z
      .object({
        id: z.number().int(),
        ratingDate: z.string(),
        assessedBy: z.string(),
        growthStage: z.string()
      })
      .parse(payload)
    const before = dao.getAssessmentHeader(id)
    dao.updateAssessmentMetadata(id, { ratingDate, assessedBy, growthStage })
    recordAudit(
      'assessment.metadata.edit',
      'assessment_header',
      `Recorded metadata for "${before?.description || before?.ratingType || id}"`,
      { before: { ratingDate: before?.ratingDate, assessedBy: before?.assessedBy, growthStage: before?.growthStage }, after: { ratingDate, assessedBy, growthStage } }
    )
    syncLibrary()
    return dao.snapshot()
  })

  handle(IPC.assessmentValueSet, (v: unknown) => {
    assertLayoutLocked()
    const val = AssessmentValue.parse(v)
    const newVal = val.value === null || Number.isNaN(val.value) ? null : val.value
    const old = dao.getAssessmentValue(val.assessmentHeaderId, val.plotId, val.subsample)
    dao.setAssessmentValue(val)
    if (old !== newVal) {
      const plot = dao.getPlot(val.plotId)
      const header = dao.getAssessmentHeader(val.assessmentHeaderId)
      const fmt = (x: number | null): string => (x === null ? '(empty)' : String(x))
      const sub = (header?.subsamples ?? 1) > 1 ? ` [sub ${val.subsample}]` : ''
      recordAudit(
        'assessment.value.set',
        'assessment_value',
        `Plot #${plot?.plotNumber ?? '?'} · ${header?.description || 'assessment'}${sub} · ${fmt(old)} → ${fmt(newVal)}`,
        { plotId: val.plotId, headerId: val.assessmentHeaderId, subsample: val.subsample, old, new: newVal }
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
    const { title, print } = z
      .object({
        title: z.string().default(''),
        // Per-document print geometry; omitted → report defaults (A4, portrait, header on).
        print: z
          .object({
            pageSize: z.enum(['A4', 'Letter']).optional(),
            landscape: z.boolean().optional(),
            margins: z
              .object({ top: z.number(), bottom: z.number(), left: z.number(), right: z.number() })
              .optional(),
            header: z.boolean().optional()
          })
          .optional()
      })
      .parse(opts ?? {})
    const win = getWindow()
    if (!win) throw new Error('No window to export from.')

    const res = await dialog.showSaveDialog(win, {
      title: 'Export PDF',
      defaultPath: `${(title || 'trial').replace(/[^\w.-]+/g, '_')}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (res.canceled || !res.filePath) return null

    const esc = (s: string): string =>
      s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    const margin = '<div style="font-size:8px; width:100%; padding:0 12mm; color:#666;">'
    const showHeader = print?.header ?? true
    const data = await win.webContents.printToPDF({
      pageSize: print?.pageSize ?? 'A4',
      landscape: print?.landscape ?? false,
      printBackground: true,
      displayHeaderFooter: showHeader,
      // inches; the report's defaults leave room for the header/footer templates.
      margins: print?.margins ?? { top: 0.7, bottom: 0.7, left: 0.6, right: 0.6 },
      ...(showHeader
        ? {
            headerTemplate: `${margin}${esc(title)}</div>`,
            footerTemplate: `${margin.replace('color:#666;', 'color:#666; display:flex; justify-content:space-between;')}<span>ART</span><span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
          }
        : {})
    })
    await writeFile(res.filePath, data)
    shell.openPath(res.filePath)
    return res.filePath
  })

  // --- Menu state (renderer tells the native menu what's applicable) ---
  handle(IPC.menuSetState, (input: unknown) => {
    const { role, hasDocument } = z
      .object({ role: z.enum(['protocol', 'trial']).nullable(), hasDocument: z.boolean() })
      .parse(input)
    setMenuEnabled('trial-from-current', role === 'protocol')
    // Library/Audit views only render with a document open.
    setMenuEnabled('nav-library', hasDocument)
    setMenuEnabled('nav-audit', hasDocument)
    // Printable documents require a trial.
    for (const id of [
      'print-fieldmap',
      'print-labels',
      'print-datasheet',
      'print-spray',
      'print-summary',
      'print-report'
    ])
      setMenuEnabled(id, role === 'trial')
    return true
  })

  // --- Library (personal curated vocabulary) ---
  handle(IPC.librarySuggest, (input: unknown) => {
    const { category, query, crop } = z
      .object({ category: LibraryCategory, query: z.string().default(''), crop: z.string().default('') })
      .parse(input)
    return library.isOpen() ? library.suggest(category, query, crop) : []
  })
  handle(IPC.libraryList, () => (library.isOpen() ? library.list() : []))
  handle(IPC.libraryUpdateLabel, (input: unknown) => {
    const { id, label } = z.object({ id: z.number().int(), label: z.string() }).parse(input)
    library.updateLabel(id, label)
    return library.list()
  })
  handle(IPC.libraryRename, (input: unknown) => {
    const { id, value } = z.object({ id: z.number().int(), value: z.string().min(1) }).parse(input)
    library.rename(id, value)
    return library.list()
  })
  handle(IPC.libraryRemove, (id: unknown) => {
    library.remove(z.number().int().parse(id))
    return library.list()
  })
  handle(IPC.libraryExport, async () => {
    const res = await dialog.showSaveDialog(getWindow()!, {
      title: 'Export Library',
      defaultPath: 'library.artlib',
      filters: [{ name: 'ART Library', extensions: ['artlib'] }]
    })
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, JSON.stringify(library.exportLibrary(), null, 2))
    return res.filePath
  })
  handle(IPC.libraryImport, async () => {
    const res = await dialog.showOpenDialog(getWindow()!, {
      title: 'Import Library',
      properties: ['openFile'],
      filters: [{ name: 'ART Library', extensions: ['artlib', 'json'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const payload = JSON.parse(await readFile(res.filePaths[0], 'utf8')) as LibraryExport
    return library.importLibrary(payload)
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
