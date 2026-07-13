import { z } from 'zod'

/**
 * Shared domain types + zod schemas. Used by the main process (validating IPC
 * payloads) and the renderer (typing the preload API). Keep this the single
 * source of truth for the data model described in the project plan.
 */

export const DesignType = z.enum(['RCB', 'CRD', 'ALPHA'])
export type DesignType = z.infer<typeof DesignType>

/** Human-readable design names for UI selectors, map headers, and reports. */
export const DESIGN_LABELS: Record<DesignType, string> = {
  RCB: 'Randomized Complete Block',
  CRD: 'Completely Randomized',
  ALPHA: 'Incomplete Block (Alpha)'
}

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
// Library (user-curated controlled vocabularies for coded fields)
// ---------------------------------------------------------------------------
/** Which coded field a library value feeds. Not a taxonomy — just the source field. */
export const LibraryCategory = z.enum([
  'crop',
  'target',
  'rating_type',
  'part_rated',
  'unit',
  'growth_stage',
  'treatment_type',
  'timing',
  'property_key'
])
export type LibraryCategory = z.infer<typeof LibraryCategory>

/** Vocabularies that apply to every crop (no per-crop scoping/ranking). All others vary by crop. */
export const GENERAL_CATEGORIES: ReadonlySet<LibraryCategory> = new Set<LibraryCategory>([
  'crop',
  'unit',
  'property_key'
])

/** Whether a category's terms are scoped/ranked by crop (e.g. rating types), vs. general (crop, unit). */
export function isCropScoped(category: LibraryCategory): boolean {
  return !GENERAL_CATEGORIES.has(category)
}

export const LIBRARY_CATEGORY_LABELS: Record<LibraryCategory, string> = {
  crop: 'Crops',
  target: 'Target organisms',
  rating_type: 'Rating types',
  part_rated: 'Parts rated',
  unit: 'Units',
  growth_stage: 'Growth stages',
  treatment_type: 'Treatment types',
  timing: 'Timings',
  property_key: 'Property keys'
}

/** A term embedded in a project (the travelling snapshot) or referenced generally. */
export const LibraryTerm = z.object({
  id: z.number().int().optional(),
  category: LibraryCategory,
  value: z.string().min(1),
  label: z.string().default('')
})
export type LibraryTerm = z.infer<typeof LibraryTerm>

/** A ranked suggestion returned to a combobox. */
export interface SuggestHit {
  value: string
  label: string
}

/** A term in the personal library, with usage + the crops it's been used on (implicit scope). */
export interface PersonalTerm {
  id: number
  category: LibraryCategory
  value: string
  label: string
  useCount: number
  crops: string[]
}

/** Portable `.artlib` payload for import/export of a personal library. */
export interface LibraryExport {
  version: number
  exportedAt: string
  terms: { category: LibraryCategory; value: string; label: string; crops: string[] }[]
}

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
  // Incomplete-block size (k) for the ALPHA design; ignored by RCB/CRD. The
  // treatment count must be divisible by k and k < treatment count.
  blockSize: z.number().int().min(2).default(2),
  plotWidth: z.number().default(0),
  plotLength: z.number().default(0)
})
export type Protocol = z.infer<typeof Protocol>

/**
 * One line of a treatment's program: a product applied at a given rate at a given application timing.
 * `applicationRef` is an application timing code (A/B/C matching an `Application`), or '' for an
 * unscheduled/at-planting line.
 */
export const TreatmentApplication = z.object({
  id: z.number().int().optional(),
  ordinal: z.number().int().default(0),
  applicationRef: z.string().default(''),
  product: z.string().default(''),
  rate: z.string().default(''),
  rateUnit: z.string().default('')
})
export type TreatmentApplication = z.infer<typeof TreatmentApplication>

/**
 * An experimental comparison unit. Its content is a **program**: an ordered sequence of applications
 * (`applications`), each with its own product, rate, and timing — so a treatment can be e.g.
 * "Product X at A, then Product Y at B". Untreated = no lines; a simple treatment = one line.
 */
export const Treatment = z.object({
  id: z.number().int().optional(),
  number: z.number().int().positive(),
  name: z.string().default(''),
  type: z.string().default(''),
  applications: z.array(TreatmentApplication).default([])
})
export type Treatment = z.infer<typeof Treatment>

/**
 * A protocol-defined application (the *plan*): ordered A/B/C… treatments-application events, each a
 * timing code + intended crop growth stage. The actual date it happened is trial-side
 * (`ApplicationActual`), because one protocol serves many sites with different planting dates.
 * Assessments anchor their timing to an application (see `AssessmentDef.applicationRef`).
 */
export const Application = z.object({
  id: z.number().int().optional(),
  ordinal: z.number().int().default(0),
  timingCode: z.string().default(''),
  /** Intended crop growth stage at this application (from the growth_stage library). */
  targetGrowthStage: z.string().default(''),
  description: z.string().default('')
})
export type Application = z.infer<typeof Application>

/** Trial-side record of when an application actually happened (keyed by the plan's timing code). */
export const ApplicationActual = z.object({
  id: z.number().int().optional(),
  timingCode: z.string().default(''),
  actualDate: z.string().default('')
})
export type ApplicationActual = z.infer<typeof ApplicationActual>

/**
 * A trial-side key/value property — the generic mechanism for ad-hoc metadata that avoids a wall of
 * dedicated columns (see docs/DESIGN-PRINCIPLES.md). Scope picks what it describes:
 *  - `trial` → additional site details (soil, previous crop, variety…), `scopeRef` = ''
 *  - `application` → conditions an application was made under, `scopeRef` = the application timing code
 * Keys come from the `property_key` library; consumed by the printed documents.
 */
export const PropertyScope = z.enum(['trial', 'application'])
export type PropertyScope = z.infer<typeof PropertyScope>

export const Property = z.object({
  id: z.number().int().optional(),
  scope: PropertyScope,
  scopeRef: z.string().default(''),
  key: z.string().default(''),
  value: z.string().default('')
})
export type Property = z.infer<typeof Property>

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
  /** Incomplete block within the replicate (ALPHA); equals `rep` for complete-block designs. */
  block: z.number().int().default(0),
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
  /** Anchor: the application (timing code) this assessment is timed relative to; '' = unanchored. */
  applicationRef: z.string().default(''),
  /** Days after the anchored application; null when unanchored. */
  daysAfter: z.number().int().nullable().default(null),
  /** Free-text timing override; when set it wins over the derived "N DA-<code>" label. */
  timing: z.string().default(''),
  description: z.string().default(''),
  ordinal: z.number().int().default(0),
  /** Whether this assessment is included in ANOVA and the report. */
  analyze: z.boolean().default(true),
  /** Measurements recorded per plot; >1 are averaged to the plot value before ANOVA. */
  subsamples: z.number().int().min(1).max(50).default(1)
})
export type AssessmentDef = z.infer<typeof AssessmentDef>

/**
 * A trial's assessment column: the definition plus **event metadata** recorded when the assessment
 * is actually performed (at data entry, not at authoring): the date, who assessed, and the crop
 * growth stage observed.
 */
export const AssessmentHeader = AssessmentDef.extend({
  trialId: z.number().int(),
  origin: AssessmentOrigin.default('site'),
  locked: z.boolean().default(false),
  /** Date the assessment was performed (ISO). */
  ratingDate: z.string().default(''),
  /** Who performed the assessment. */
  assessedBy: z.string().default(''),
  /** Crop growth stage observed at this assessment (from the growth_stage library). */
  growthStage: z.string().default('')
})
export type AssessmentHeader = z.infer<typeof AssessmentHeader>

export const AssessmentValue = z.object({
  assessmentHeaderId: z.number().int(),
  plotId: z.number().int(),
  /** 1-based subsample index; 1 is the default single measurement. */
  subsample: z.number().int().min(1).default(1),
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
  /** Incomplete-block size (k) for ALPHA; unused by RCB/CRD. */
  blockSize: z.number().int().min(2).optional(),
  seed: z.number().int()
})
export type RandomizeRequest = z.infer<typeof RandomizeRequest>

/** One randomized plot as returned by R: order = field order (plot sequence). */
export interface RandomizedPlot {
  order: number
  rep: number
  /** Incomplete block within the replicate (ALPHA); equals `rep` for complete-block designs. */
  block: number
  treatment: number // treatment *number* (1-based), mapped to treatmentId by caller
}

// ---------------------------------------------------------------------------
// ANOVA request/response
// ---------------------------------------------------------------------------
export const AovRequest = z.object({
  design: DesignType,
  test: MeanComparisonTest,
  alpha: AlphaLevel,
  /** Incomplete-block size (k) for ALPHA; unused by RCB/CRD. */
  blockSize: z.number().int().min(2).optional(),
  /** Long-form observations. treatment = 1-based number, rep = 1-based replicate. */
  data: z.array(
    z.object({
      treatment: z.number().int(),
      rep: z.number().int(),
      /** Incomplete block (ALPHA only); ignored by RCB/CRD. */
      block: z.number().int().optional(),
      value: z.number()
    })
  )
})
export type AovRequest = z.infer<typeof AovRequest>

export interface AovAnovaRow {
  source: string
  df: number
  // SS/MS are absent for the ALPHA design's REML fit (PBIB.test), hence nullable.
  ss: number | null
  ms: number | null
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
  /**
   * Set when the dataset is too degenerate for a full analysis (e.g. no residual
   * degrees of freedom / unbalanced data). When present, `means` is empty and the
   * numeric summaries should not be shown — display this note instead.
   */
  note?: string
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
  /** Trial-side actual application dates (empty for a protocol document). */
  applicationActuals: ApplicationActual[]
  /** Trial-side key/value properties (site details + application conditions). */
  properties: Property[]
  /** Snapshot of the coded terms this document references (travels into trials). */
  libraryTerms: LibraryTerm[]
}

/**
 * Per-document print geometry passed to the PDF export. Electron's `printToPDF` options override CSS
 * `@page`, so each printable document supplies its own page size, orientation, margins, and whether
 * the running "ART / page-number" header+footer should show (wanted on the report, not on a field
 * map or a label sheet). Omitted fields fall back to the report defaults (A4, portrait, header on).
 */
export interface PrintProfile {
  pageSize?: 'A4' | 'Letter'
  landscape?: boolean
  /** Page margins in inches. */
  margins?: { top: number; bottom: number; left: number; right: number }
  /** Show the ART title header + page-number footer (default true). */
  header?: boolean
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
