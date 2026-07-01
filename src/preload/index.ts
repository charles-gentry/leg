import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc.js'
import type {
  Protocol,
  Treatment,
  Application,
  AssessmentDef,
  AssessmentHeader,
  AssessmentValue,
  AovRequest,
  AovResult,
  AuditEntry,
  ProjectSnapshot,
  REnvStatus,
  SiteMetadata
} from '../shared/types.js'

/** The API surface exposed to the renderer. Every method is a typed IPC invoke. */
const api = {
  project: {
    snapshot: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke(IPC.projectSnapshot),
    close: (): Promise<boolean> => ipcRenderer.invoke(IPC.projectClose)
  },
  protocol: {
    new: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke(IPC.protocolNew),
    open: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke(IPC.protocolOpen),
    save: (p: Protocol): Promise<Protocol> => ipcRenderer.invoke(IPC.protocolSave, p)
  },
  treatments: {
    save: (list: Treatment[]): Promise<Treatment[]> => ipcRenderer.invoke(IPC.treatmentsSave, list)
  },
  applications: {
    save: (list: Application[]): Promise<Application[]> =>
      ipcRenderer.invoke(IPC.applicationsSave, list)
  },
  trial: {
    newFromProtocol: (): Promise<ProjectSnapshot | null> =>
      ipcRenderer.invoke(IPC.trialNewFromProtocol),
    open: (): Promise<ProjectSnapshot | null> => ipcRenderer.invoke(IPC.trialOpen),
    generate: (cfg: Partial<SiteMetadata> & { seed?: number }): Promise<ProjectSnapshot> =>
      ipcRenderer.invoke(IPC.trialGenerate, cfg),
    lockLayout: (): Promise<ProjectSnapshot> => ipcRenderer.invoke(IPC.trialLockLayout),
    swapPlots: (a: number, b: number): Promise<ProjectSnapshot> =>
      ipcRenderer.invoke(IPC.plotSwap, a, b),
    setPlotExcluded: (plotId: number, excluded: boolean, reason: string): Promise<ProjectSnapshot> =>
      ipcRenderer.invoke(IPC.plotSetExcluded, { plotId, excluded, reason })
  },
  assessments: {
    saveDefs: (list: AssessmentDef[]): Promise<AssessmentDef[]> =>
      ipcRenderer.invoke(IPC.assessmentDefSave, list),
    addSiteHeader: (h: AssessmentHeader): Promise<AssessmentHeader[]> =>
      ipcRenderer.invoke(IPC.assessmentHeaderAddSite, h),
    upsertHeader: (h: AssessmentHeader): Promise<AssessmentHeader[]> =>
      ipcRenderer.invoke(IPC.assessmentHeaderUpsert, h),
    deleteHeader: (id: number): Promise<AssessmentHeader[]> =>
      ipcRenderer.invoke(IPC.assessmentHeaderDelete, id),
    setValue: (v: AssessmentValue): Promise<boolean> =>
      ipcRenderer.invoke(IPC.assessmentValueSet, v)
  },
  stats: {
    runAov: (headerId: number, req: AovRequest): Promise<AovResult> =>
      ipcRenderer.invoke(IPC.statsRunAov, headerId, req)
  },
  report: {
    exportPdf: (opts: { title: string }): Promise<string | null> =>
      ipcRenderer.invoke(IPC.reportExportPdf, opts)
  },
  audit: {
    list: (): Promise<AuditEntry[]> => ipcRenderer.invoke(IPC.auditList)
  },
  env: {
    detectR: (): Promise<REnvStatus> => ipcRenderer.invoke(IPC.envDetectR),
    setRscriptPath: (p: string): Promise<REnvStatus> =>
      ipcRenderer.invoke(IPC.envSetRscriptPath, p)
  }
}

export type ArmApi = typeof api

contextBridge.exposeInMainWorld('arm', api)
