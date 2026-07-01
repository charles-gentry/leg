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
  trialOpen: 'trial:open',
  trialGenerate: 'trial:generate',
  trialLockLayout: 'trial:lockLayout',
  plotSwap: 'plot:swap',
  plotSetExcluded: 'plot:setExcluded',

  // Assessments
  assessmentHeaderAddSite: 'assessment:header:addSite',
  assessmentHeaderUpsert: 'assessment:header:upsert',
  assessmentHeaderDelete: 'assessment:header:delete',
  assessmentValueSet: 'assessment:value:set',

  // Stats
  statsRunAov: 'stats:runAov',

  // Report
  reportExportPdf: 'report:exportPdf',

  // Audit
  auditList: 'audit:list',

  // Environment / R
  envDetectR: 'env:detectR',
  envSetRscriptPath: 'env:setRscriptPath'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
