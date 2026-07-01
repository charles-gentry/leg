import { z } from 'zod'

/**
 * Shared domain types + zod schemas. Used by the main process (validating IPC
 * payloads) and the renderer (typing the preload API). Keep this the single
 * source of truth for the data model described in the project plan.
 */

export const DesignType = z.enum(['RCB', 'CRD'])
export type DesignType = z.infer<typeof DesignType>

/** Document role: an authored protocol template, or a local trial instance. */
export const Role = z.enum(['protocol', 'trial'])
export type Role = z.infer<typeof Role>

/** Origin of an assessment column: protocol-defined (locked) vs. operator-added. */
export const AssessmentOrigin = z.enum(['core', 'site'])
export type AssessmentOrigin = z.infer<typeof AssessmentOrigin>

export const MeanComparisonTest = z.enum(['LSD', 'TUKEY', 'DUNCAN', 'SNK'])
export type MeanComparisonTest = z.infer<typeof MeanComparisonTest>

export const AlphaLevel = z.union([z.literal(0.01), z.literal(0.05), z.literal(0.1)])
export type AlphaLevel = z.infer<typeof AlphaLevel>

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------
export const Protocol = z.object({
  id: z.number().int().optional(),
  protocolUid: z.string().default(''),
  protocolVersion: z.number().int().default(1),
  title: z.string().default(''),
  crop: z.string().default(''),
  targetPest: z.string().default(''),
  objective: z.string().default(''),
  investigator: z.string().default(''),
  season: z.string().default(''),
  notes: z.string().default(''),
  // Experimental design is dictated by the protocol; sites differ only by randomization.
  design: DesignType.default('RCB'),
  replicates: z.number().int().min(2).max(20).default(4),
  plotWidth: z.number().default(0),
  plotLength: z.number().default(0)
})
export type Protocol = z.infer<typeof Protocol>

export const Treatment = z.object({
  id: z.number().int().optional(),
  number: z.number().int().positive(),
  name: z.string().default(''),
  product: z.string().default(''),
  rate: z.string().default(''),
  rateUnit: z.string().default(''),
  type: z.string().default('')
})
export type Treatment = z.infer<typeof Treatment>

export const Application = z.object({
  id: z.number().int().optional(),
  timingCode: z.string().default(''),
  description: z.string().default(''),
  plannedDate: z.string().default(''),
  growthStage: z.string().default('')
})
export type Application = z.infer<typeof Application>

// ---------------------------------------------------------------------------
// Trial + layout
// ---------------------------------------------------------------------------
/** Site/operator metadata recorded by the trial location. */
export const SiteMetadata = z.object({
  siteName: z.string().default(''),
  operator: z.string().default(''),
  location: z.string().default(''),
  city: z.string().default(''),
  state: z.string().default(''),
  country: z.string().default(''),
  plantingDate: z.string().default(''),
  trialNotes: z.string().default('')
})
export type SiteMetadata = z.infer<typeof SiteMetadata>

export const Trial = SiteMetadata.extend({
  id: z.number().int().optional(),
  protocolId: z.number().int(),
  plotRows: z.number().int().positive(),
  plotCols: z.number().int().positive(),
  seed: z.number().int(),
  /** ISO timestamp when the layout was confirmed & locked; '' while a draft. */
  layoutLockedAt: z.string().default('')
})
export type Trial = z.infer<typeof Trial>

export const Plot = z.object({
  id: z.number().int().optional(),
  trialId: z.number().int(),
  plotNumber: z.number().int(),
  rep: z.number().int(),
  treatmentId: z.number().int(),
  mapRow: z.number().int(),
  mapCol: z.number().int(),
  excluded: z.boolean().default(false),
  excludeReason: z.string().default('')
})
export type Plot = z.infer<typeof Plot>

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------
/** A protocol-authored assessment definition (no trial binding). */
export const AssessmentDef = z.object({
  id: z.number().int().optional(),
  partRated: z.string().default(''),
  ratingType: z.string().default(''),
  ratingUnit: z.string().default(''),
  timing: z.string().default(''),
  ratingDate: z.string().default(''),
  description: z.string().default(''),
  ordinal: z.number().int().default(0),
  /** Whether this assessment is included in ANOVA and the report. */
  analyze: z.boolean().default(true)
})
export type AssessmentDef = z.infer<typeof AssessmentDef>

export const AssessmentHeader = AssessmentDef.extend({
  trialId: z.number().int(),
  origin: AssessmentOrigin.default('site'),
  locked: z.boolean().default(false)
})
export type AssessmentHeader = z.infer<typeof AssessmentHeader>

export const AssessmentValue = z.object({
  assessmentHeaderId: z.number().int(),
  plotId: z.number().int(),
  value: z.number().nullable()
})
export type AssessmentValue = z.infer<typeof AssessmentValue>

// ---------------------------------------------------------------------------
// Randomization request/response (main <-> R)
// ---------------------------------------------------------------------------
export const RandomizeRequest = z.object({
  design: DesignType,
  treatments: z.number().int().min(2),
  replicates: z.number().int().min(2),
  seed: z.number().int()
})
export type RandomizeRequest = z.infer<typeof RandomizeRequest>

/** One randomized plot as returned by R: order = field order (plot sequence). */
export interface RandomizedPlot {
  order: number
  rep: number
  treatment: number // treatment *number* (1-based), mapped to treatmentId by caller
}

// ---------------------------------------------------------------------------
// ANOVA request/response
// ---------------------------------------------------------------------------
export const AovRequest = z.object({
  design: DesignType,
  test: MeanComparisonTest,
  alpha: AlphaLevel,
  /** Long-form observations. treatment = 1-based number, rep = 1-based block. */
  data: z.array(
    z.object({
      treatment: z.number().int(),
      rep: z.number().int(),
      value: z.number()
    })
  )
})
export type AovRequest = z.infer<typeof AovRequest>

export interface AovAnovaRow {
  source: string
  df: number
  ss: number
  ms: number
  f: number | null
  pValue: number | null
}

export interface TreatmentMean {
  treatment: number
  mean: number
  n: number
  std: number
  /** Mean-separation grouping letters, e.g. "a", "ab". */
  group: string
}

export interface AovResult {
  anova: AovAnovaRow[]
  means: TreatmentMean[]
  grandMean: number
  cv: number // coefficient of variation, percent
  lsd: number | null // critical value (LSD or HSD depending on test)
  criticalValueLabel: string // "LSD (0.05)" / "HSD (0.05)" etc.
  stdError: number
  test: MeanComparisonTest
  alpha: AlphaLevel
  significant: boolean // treatment effect significant at alpha
}

// ---------------------------------------------------------------------------
// Environment / R detection
// ---------------------------------------------------------------------------
export interface REnvStatus {
  rscriptFound: boolean
  rscriptPath: string | null
  version: string | null
  agricolaeInstalled: boolean
  message: string
}

// ---------------------------------------------------------------------------
// Project bundle (everything the renderer needs after opening a file)
// ---------------------------------------------------------------------------
export interface ProjectSnapshot {
  filePath: string
  role: Role
  protocol: Protocol
  treatments: Treatment[]
  applications: Application[]
  assessmentDefs: AssessmentDef[]
  trial: Trial | null
  plots: Plot[]
  assessmentHeaders: AssessmentHeader[]
  assessmentValues: AssessmentValue[]
}

// ---------------------------------------------------------------------------
// Audit trail (GEP/GLP)
// ---------------------------------------------------------------------------
export interface AuditEntry {
  id: number
  ts: string // UTC ISO timestamp
  actor: string // OS account
  role: Role | ''
  action: string // machine code, e.g. "assessment.value.set"
  entity: string
  summary: string // human-readable, includes old -> new where relevant
  detail: Record<string, unknown>
}

/** Standard envelope returned by the R runner. */
export interface RResponse<T> {
  ok: boolean
  result?: T
  error?: string
}
