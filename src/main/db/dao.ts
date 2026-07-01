import Database from 'better-sqlite3'
import { getDb, openProject, getCurrentPath, getRole } from './connection.js'
import type {
  Protocol,
  Treatment,
  Application,
  AssessmentDef,
  Trial,
  Plot,
  AssessmentHeader,
  AssessmentValue,
  ProjectSnapshot
} from '@shared/types.js'

/**
 * Data-access layer. All row mapping between snake_case columns and camelCase
 * domain types lives here so the rest of main/ never touches raw SQL rows.
 */

// --- Protocol (singleton row id = 1) ---------------------------------------
export function getProtocol(db: Database.Database = getDb()): Protocol {
  const r = db.prepare(`SELECT * FROM protocol WHERE id = 1`).get() as Record<string, unknown>
  return {
    id: 1,
    protocolUid: r.protocol_uid as string,
    protocolVersion: r.protocol_version as number,
    title: r.title as string,
    crop: r.crop as string,
    targetPest: r.target_pest as string,
    objective: r.objective as string,
    investigator: r.investigator as string,
    season: r.season as string,
    notes: r.notes as string,
    design: r.design as Protocol['design'],
    replicates: r.replicates as number,
    plotWidth: r.plot_width as number,
    plotLength: r.plot_length as number
  }
}

/**
 * Save protocol fields. protocol_uid is never overwritten once assigned (it is the
 * identity used to match returned trials back to the author's protocol). When `uid`
 * is provided (copying a protocol into a trial file) it is written verbatim.
 */
export function saveProtocol(
  p: Protocol,
  db: Database.Database = getDb(),
  uid?: string
): void {
  if (uid) {
    db.prepare(`UPDATE protocol SET protocol_uid=@uid, protocol_version=@version WHERE id = 1`).run(
      { uid, version: p.protocolVersion }
    )
  }
  db.prepare(
    `UPDATE protocol SET title=@title, crop=@crop, target_pest=@targetPest,
       objective=@objective, investigator=@investigator, season=@season, notes=@notes,
       design=@design, replicates=@replicates, plot_width=@plotWidth, plot_length=@plotLength
     WHERE id = 1`
  ).run({
    title: p.title,
    crop: p.crop,
    targetPest: p.targetPest,
    objective: p.objective,
    investigator: p.investigator,
    season: p.season,
    notes: p.notes,
    design: p.design,
    replicates: p.replicates,
    plotWidth: p.plotWidth,
    plotLength: p.plotLength
  })
}

// --- Treatments -------------------------------------------------------------
export function listTreatments(db: Database.Database = getDb()): Treatment[] {
  const rows = db
    .prepare(`SELECT * FROM treatment ORDER BY number`)
    .all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    number: r.number as number,
    name: r.name as string,
    product: r.product as string,
    rate: r.rate as string,
    rateUnit: r.rate_unit as string,
    type: r.type as string
  }))
}

/** Replace the entire treatment list in one transaction (simplest to keep in sync with UI). */
export function replaceTreatments(treatments: Treatment[], db: Database.Database = getDb()): void {
  const tx = db.transaction((items: Treatment[]) => {
    db.prepare('DELETE FROM treatment').run()
    const ins = db.prepare(
      `INSERT INTO treatment (number, name, product, rate, rate_unit, type)
       VALUES (@number, @name, @product, @rate, @rateUnit, @type)`
    )
    for (const t of items) {
      ins.run({
        number: t.number,
        name: t.name,
        product: t.product,
        rate: t.rate,
        rateUnit: t.rateUnit,
        type: t.type
      })
    }
  })
  tx(treatments)
}

// --- Applications -----------------------------------------------------------
export function listApplications(db: Database.Database = getDb()): Application[] {
  const rows = db.prepare(`SELECT * FROM application ORDER BY id`).all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    timingCode: r.timing_code as string,
    description: r.description as string,
    plannedDate: r.planned_date as string,
    growthStage: r.growth_stage as string
  }))
}

export function replaceApplications(apps: Application[], db: Database.Database = getDb()): void {
  const tx = db.transaction((items: Application[]) => {
    db.prepare('DELETE FROM application').run()
    const ins = db.prepare(
      `INSERT INTO application (timing_code, description, planned_date, growth_stage)
       VALUES (@timingCode, @description, @plannedDate, @growthStage)`
    )
    for (const a of items) ins.run(a)
  })
  tx(apps)
}

// --- Assessment definitions (protocol-owned) --------------------------------
export function listAssessmentDefs(db: Database.Database = getDb()): AssessmentDef[] {
  const rows = db
    .prepare(`SELECT * FROM assessment_def ORDER BY ordinal, id`)
    .all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    partRated: r.part_rated as string,
    ratingType: r.rating_type as string,
    ratingUnit: r.rating_unit as string,
    timing: r.timing as string,
    ratingDate: r.rating_date as string,
    description: r.description as string,
    ordinal: r.ordinal as number,
    analyze: !!(r.analyze as number)
  }))
}

export function replaceAssessmentDefs(defs: AssessmentDef[], db: Database.Database = getDb()): void {
  const tx = db.transaction((items: AssessmentDef[]) => {
    db.prepare('DELETE FROM assessment_def').run()
    const ins = db.prepare(
      `INSERT INTO assessment_def (part_rated, rating_type, rating_unit, timing, rating_date, description, ordinal, analyze)
       VALUES (@partRated, @ratingType, @ratingUnit, @timing, @ratingDate, @description, @ordinal, @analyze)`
    )
    items.forEach((d, i) => ins.run({ ...d, ordinal: d.ordinal ?? i, analyze: d.analyze === false ? 0 : 1 }))
  })
  tx(defs)
}

// --- Trial ------------------------------------------------------------------
export function getTrial(db: Database.Database = getDb()): Trial | null {
  const r = db.prepare(`SELECT * FROM trial ORDER BY id DESC LIMIT 1`).get() as
    | Record<string, unknown>
    | undefined
  if (!r) return null
  return {
    id: r.id as number,
    protocolId: r.protocol_id as number,
    plotRows: r.plot_rows as number,
    plotCols: r.plot_cols as number,
    seed: r.seed as number,
    siteName: r.site_name as string,
    operator: r.operator as string,
    location: r.location as string,
    city: r.city as string,
    state: r.state as string,
    country: r.country as string,
    plantingDate: r.planting_date as string,
    trialNotes: r.trial_notes as string,
    layoutLockedAt: r.layout_locked_at as string
  }
}

/** Persist a freshly generated trial + its plots, replacing any prior trial. */
export function replaceTrialWithPlots(
  trial: Omit<Trial, 'id' | 'layoutLockedAt'>,
  plots: Omit<Plot, 'id' | 'trialId' | 'excluded' | 'excludeReason'>[],
  db: Database.Database = getDb()
): number {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM trial').run() // cascades to plot / assessment_header / values
    const info = db
      .prepare(
        `INSERT INTO trial (protocol_id, plot_rows, plot_cols, seed,
           site_name, operator, location, city, state, country, planting_date, trial_notes)
         VALUES (@protocolId, @plotRows, @plotCols, @seed,
           @siteName, @operator, @location, @city, @state, @country, @plantingDate, @trialNotes)`
      )
      .run(trial)
    const trialId = info.lastInsertRowid as number
    const ins = db.prepare(
      `INSERT INTO plot (trial_id, plot_number, rep, treatment_id, map_row, map_col)
       VALUES (@trialId, @plotNumber, @rep, @treatmentId, @mapRow, @mapCol)`
    )
    for (const p of plots) ins.run({ ...p, trialId })
    return trialId
  })
  return tx()
}

export function listPlots(trialId: number, db: Database.Database = getDb()): Plot[] {
  const rows = db
    .prepare(`SELECT * FROM plot WHERE trial_id = ? ORDER BY plot_number`)
    .all(trialId) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    trialId: r.trial_id as number,
    plotNumber: r.plot_number as number,
    rep: r.rep as number,
    treatmentId: r.treatment_id as number,
    mapRow: r.map_row as number,
    mapCol: r.map_col as number,
    excluded: !!(r.excluded as number),
    excludeReason: r.exclude_reason as string
  }))
}

/** Fetch a single plot by id (used for audit summaries). */
export function getPlot(id: number, db: Database.Database = getDb()): Plot | null {
  const r = db.prepare(`SELECT * FROM plot WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined
  if (!r) return null
  return {
    id: r.id as number,
    trialId: r.trial_id as number,
    plotNumber: r.plot_number as number,
    rep: r.rep as number,
    treatmentId: r.treatment_id as number,
    mapRow: r.map_row as number,
    mapCol: r.map_col as number,
    excluded: !!(r.excluded as number),
    excludeReason: r.exclude_reason as string
  }
}

/** Confirm & lock the layout: stamp the trial with an ISO timestamp. One-way. */
export function lockLayout(db: Database.Database = getDb()): string {
  const ts = new Date().toISOString()
  db.prepare(`UPDATE trial SET layout_locked_at = ?`).run(ts)
  return ts
}

/** Flag (or clear) a plot's exclusion from analysis. Data itself is retained. */
export function setPlotExcluded(
  plotId: number,
  excluded: boolean,
  reason: string,
  db: Database.Database = getDb()
): void {
  db.prepare(`UPDATE plot SET excluded = ?, exclude_reason = ? WHERE id = ?`).run(
    excluded ? 1 : 0,
    excluded ? reason : '',
    plotId
  )
}

/** Swap the treatment assignment of two plots (ARM-style hot edit). */
export function swapPlotTreatments(plotIdA: number, plotIdB: number, db: Database.Database = getDb()): void {
  const tx = db.transaction(() => {
    const a = db.prepare('SELECT treatment_id FROM plot WHERE id = ?').get(plotIdA) as
      | { treatment_id: number }
      | undefined
    const b = db.prepare('SELECT treatment_id FROM plot WHERE id = ?').get(plotIdB) as
      | { treatment_id: number }
      | undefined
    if (!a || !b) throw new Error('Plot not found for swap')
    db.prepare('UPDATE plot SET treatment_id = ? WHERE id = ?').run(b.treatment_id, plotIdA)
    db.prepare('UPDATE plot SET treatment_id = ? WHERE id = ?').run(a.treatment_id, plotIdB)
  })
  tx()
}

// --- Assessments ------------------------------------------------------------
export function listAssessmentHeaders(
  trialId: number,
  db: Database.Database = getDb()
): AssessmentHeader[] {
  const rows = db
    .prepare(`SELECT * FROM assessment_header WHERE trial_id = ? ORDER BY ordinal, id`)
    .all(trialId) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    trialId: r.trial_id as number,
    partRated: r.part_rated as string,
    ratingType: r.rating_type as string,
    ratingUnit: r.rating_unit as string,
    timing: r.timing as string,
    ratingDate: r.rating_date as string,
    description: r.description as string,
    ordinal: r.ordinal as number,
    origin: r.origin as AssessmentHeader['origin'],
    locked: !!(r.locked as number),
    analyze: !!(r.analyze as number)
  }))
}

export function upsertAssessmentHeader(
  h: AssessmentHeader,
  db: Database.Database = getDb()
): number {
  const flags = { locked: h.locked ? 1 : 0, analyze: h.analyze === false ? 0 : 1 }
  if (h.id) {
    db.prepare(
      `UPDATE assessment_header SET part_rated=@partRated, rating_type=@ratingType,
        rating_unit=@ratingUnit, timing=@timing, rating_date=@ratingDate,
        description=@description, ordinal=@ordinal, origin=@origin, locked=@locked, analyze=@analyze WHERE id=@id`
    ).run({ ...h, ...flags })
    return h.id
  }
  const info = db
    .prepare(
      `INSERT INTO assessment_header (trial_id, part_rated, rating_type, rating_unit, timing, rating_date, description, ordinal, origin, locked, analyze)
       VALUES (@trialId, @partRated, @ratingType, @ratingUnit, @timing, @ratingDate, @description, @ordinal, @origin, @locked, @analyze)`
    )
    .run({ ...h, origin: h.origin ?? 'site', ...flags })
  return info.lastInsertRowid as number
}

/** Look up a single header (used by guards to check origin before mutating). */
export function getAssessmentHeader(
  id: number,
  db: Database.Database = getDb()
): AssessmentHeader | null {
  const r = db.prepare(`SELECT * FROM assessment_header WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined
  if (!r) return null
  return {
    id: r.id as number,
    trialId: r.trial_id as number,
    partRated: r.part_rated as string,
    ratingType: r.rating_type as string,
    ratingUnit: r.rating_unit as string,
    timing: r.timing as string,
    ratingDate: r.rating_date as string,
    description: r.description as string,
    ordinal: r.ordinal as number,
    origin: r.origin as AssessmentHeader['origin'],
    locked: !!(r.locked as number),
    analyze: !!(r.analyze as number)
  }
}

export function deleteAssessmentHeader(id: number, db: Database.Database = getDb()): void {
  db.prepare('DELETE FROM assessment_header WHERE id = ?').run(id)
}

export function listAssessmentValues(
  trialId: number,
  db: Database.Database = getDb()
): AssessmentValue[] {
  const rows = db
    .prepare(
      `SELECT av.assessment_header_id, av.plot_id, av.value
       FROM assessment_value av
       JOIN plot p ON p.id = av.plot_id
       WHERE p.trial_id = ?`
    )
    .all(trialId) as Record<string, unknown>[]
  return rows.map((r) => ({
    assessmentHeaderId: r.assessment_header_id as number,
    plotId: r.plot_id as number,
    value: r.value as number | null
  }))
}

/** Read one cell's current value (null if unset). Used to capture old→new for audit. */
export function getAssessmentValue(
  assessmentHeaderId: number,
  plotId: number,
  db: Database.Database = getDb()
): number | null {
  const r = db
    .prepare(
      `SELECT value FROM assessment_value WHERE assessment_header_id = ? AND plot_id = ?`
    )
    .get(assessmentHeaderId, plotId) as { value: number | null } | undefined
  return r ? r.value : null
}

/** Set (or clear) one cell. A null value deletes the row. */
export function setAssessmentValue(v: AssessmentValue, db: Database.Database = getDb()): void {
  if (v.value === null || Number.isNaN(v.value)) {
    db.prepare(
      'DELETE FROM assessment_value WHERE assessment_header_id = ? AND plot_id = ?'
    ).run(v.assessmentHeaderId, v.plotId)
    return
  }
  db.prepare(
    `INSERT INTO assessment_value (assessment_header_id, plot_id, value)
     VALUES (@assessmentHeaderId, @plotId, @value)
     ON CONFLICT (assessment_header_id, plot_id) DO UPDATE SET value = excluded.value`
  ).run(v)
}

// --- Analysis cache ---------------------------------------------------------
export function saveAnalysisResult(
  assessmentHeaderId: number,
  engineVersion: string,
  params: unknown,
  result: unknown,
  db: Database.Database = getDb()
): void {
  db.prepare(
    `INSERT INTO analysis_result (assessment_header_id, engine_version, params_json, result_json)
     VALUES (?, ?, ?, ?)`
  ).run(assessmentHeaderId, engineVersion, JSON.stringify(params), JSON.stringify(result))
}

// --- Create a trial from a protocol -----------------------------------------
/**
 * Create a new trial file at `destPath` from the protocol at `sourcePath`.
 * The protocol content (metadata, design, treatments, applications, assessment
 * defs) is copied verbatim — including protocol_uid/version, the identity used to
 * match the returned trial back to its protocol — and the file is stamped role='trial'
 * so the copy is locked. The trial layout itself is generated later (trial:generate).
 *
 * The source is read via a *separate* readonly handle; only after it is closed do we
 * call openProject(destPath), which replaces the process-global current handle.
 */
export function createTrialFromProtocol(sourcePath: string, destPath: string): void {
  const src = new Database(sourcePath, { readonly: true })
  let protocol: Protocol
  let treatments: Treatment[]
  let applications: Application[]
  let defs: AssessmentDef[]
  try {
    protocol = getProtocol(src)
    treatments = listTreatments(src)
    applications = listApplications(src)
    defs = listAssessmentDefs(src)
  } finally {
    src.close()
  }

  openProject(destPath, { role: 'trial', create: true })
  saveProtocol(protocol, getDb(), protocol.protocolUid)
  replaceTreatments(treatments)
  replaceApplications(applications)
  replaceAssessmentDefs(defs)
}

/** Materialize the protocol's core assessment defs as locked headers on a trial. */
export function materializeCoreHeaders(trialId: number, db: Database.Database = getDb()): void {
  const defs = listAssessmentDefs(db)
  defs.forEach((d, i) => {
    upsertAssessmentHeader(
      {
        trialId,
        partRated: d.partRated,
        ratingType: d.ratingType,
        ratingUnit: d.ratingUnit,
        timing: d.timing,
        ratingDate: d.ratingDate,
        description: d.description,
        ordinal: d.ordinal ?? i,
        origin: 'core',
        locked: true,
        analyze: d.analyze
      },
      db
    )
  })
}

// --- Full snapshot ----------------------------------------------------------
export function snapshot(db: Database.Database = getDb()): ProjectSnapshot {
  const trial = getTrial(db)
  return {
    filePath: getCurrentPath() ?? '',
    role: getRole(),
    protocol: getProtocol(db),
    treatments: listTreatments(db),
    applications: listApplications(db),
    assessmentDefs: listAssessmentDefs(db),
    trial,
    plots: trial ? listPlots(trial.id!, db) : [],
    assessmentHeaders: trial ? listAssessmentHeaders(trial.id!, db) : [],
    assessmentValues: trial ? listAssessmentValues(trial.id!, db) : []
  }
}
