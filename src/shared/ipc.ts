/** Central registry of IPC channel names, shared by main handlers and preload. */
export const IPC = {
  // Documents (role-agnostic)
  projectSnapshot: 'project:snapshot',
  projectClose: 'project:close',

  // Protocol authoring
  protocolNew: 'protocol:new',
  protocolOpen: 'protocol:open',
  protocolSave: 'protocol:save',
  treatmentsSave: 'treatments:save',
  applicationsSave: 'applications:save',
  assessmentDefSave: 'assessment:def:save',

  // Trial (created from a protocol)
  trialNewFromProtocol: 'trial:newFromProtocol',
  trialNewFromCurrent: 'trial:newFromCurrentProtocol',
  trialOpen: 'trial:open',
  trialGenerate: 'trial:generate',
  trialLockLayout: 'trial:lockLayout',
  applicationActualsSave: 'trial:applicationActuals:save',
  plotSwap: 'plot:swap',
  plotMove: 'plot:move',
  layoutReshape: 'layout:reshape',
  plotSetExcluded: 'plot:setExcluded',

  // Assessments
  assessmentHeaderAddSite: 'assessment:header:addSite',
  assessmentHeaderUpsert: 'assessment:header:upsert',
  assessmentHeaderDelete: 'assessment:header:delete',
  assessmentValueSet: 'assessment:value:set',

  // Library (personal curated vocabulary)
  librarySuggest: 'library:suggest',
  libraryList: 'library:list',
  libraryUpdateLabel: 'library:updateLabel',
  libraryRename: 'library:rename',
  libraryRemove: 'library:remove',
  libraryExport: 'library:export',
  libraryImport: 'library:import',

  // Stats
  statsRunAov: 'stats:runAov',

  // Report
  reportExportPdf: 'report:exportPdf',

  // Menu (native menu bar ↔ renderer)
  menuSetState: 'menu:setState',

  // Audit
  auditList: 'audit:list',

  // Environment / R
  envDetectR: 'env:detectR',
  envSetRscriptPath: 'env:setRscriptPath'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
