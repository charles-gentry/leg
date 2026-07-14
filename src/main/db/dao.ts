import Database from 'better-sqlite3'
import { getDb, openProject, getCurrentPath, getRole } from './connection.js'
import type {
  Protocol,
  Treatment,
  Application,
  ApplicationActual,
  Property,
  MeasurementDef,
  Trial,
  SiteMetadata,
  Plot,
  MeasurementHeader,
  MeasurementValue,
  LibraryTerm,
  ProjectSnapshot
} from '@shared/types.js'
import {
  extractProtocol,
  extractTreatments,
  extractApplications,
  extractMeasurementDefs,
  extractMeasurementHeaders,
  extractProperties,
  dedupeTerms,
  type TermRef
} from '../library/extract.js'

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
    blockSize: (r.block_size as number) ?? 2,
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
       design=@design, replicates=@replicates, block_size=@blockSize,
       plot_width=@plotWidth, plot_length=@plotLength
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
    blockSize: p.blockSize ?? 2,
    plotWidth: p.plotWidth,
    plotLength: p.plotLength
  })
}

// --- Treatments -------------------------------------------------------------
export function listTreatments(db: Database.Database = getDb()): Treatment[] {
  const rows = db
    .prepare(`SELECT * FROM treatment ORDER BY number`)
    .all() as Record<string, unknown>[]
  const lineRows = db
    .prepare(`SELECT * FROM treatment_application ORDER BY treatment_id, ordinal, id`)
    .all() as Record<string, unknown>[]
  const linesByTrt = new Map<number, Treatment['applications']>()
  for (const l of lineRows) {
    const tid = l.treatment_id as number
    const arr = linesByTrt.get(tid) ?? []
    arr.push({
      id: l.id as number,
      ordinal: (l.ordinal as number) ?? 0,
      applicationRef: (l.application_ref as string) ?? '',
      product: l.product as string,
      rate: l.rate as string,
      rateUnit: l.rate_unit as string
    })
    linesByTrt.set(tid, arr)
  }
  return rows.map((r) => ({
    id: r.id as number,
    number: r.number as number,
    name: r.name as string,
    type: r.type as string,
    isCheck: !!(r.is_check as number),
    applications: linesByTrt.get(r.id as number) ?? []
  }))
}

/**
 * Replace the entire treatment list (with each treatment's program of application lines) in one
 * transaction. Treatments are re-inserted (new ids); their lines are written under the new ids.
 */
export function replaceTreatments(treatments: Treatment[], db: Database.Database = getDb()): void {
  const tx = db.transaction((items: Treatment[]) => {
    db.prepare('DELETE FROM treatment').run() // cascades to treatment_application
    const insT = db.prepare(
      `INSERT INTO treatment (number, name, type, is_check) VALUES (@number, @name, @type, @isCheck)`
    )
    const insL = db.prepare(
      `INSERT INTO treatment_application (treatment_id, ordinal, application_ref, product, rate, rate_unit)
       VALUES (@treatmentId, @ordinal, @applicationRef, @product, @rate, @rateUnit)`
    )
    for (const t of items) {
      const info = insT.run({ number: t.number, name: t.name, type: t.type, isCheck: t.isCheck ? 1 : 0 })
      const treatmentId = info.lastInsertRowid as number
      ;(t.applications ?? []).forEach((l, i) =>
        insL.run({
          treatmentId,
          ordinal: l.ordinal ?? i,
          applicationRef: l.applicationRef ?? '',
          product: l.product ?? '',
          rate: l.rate ?? '',
          rateUnit: l.rateUnit ?? ''
        })
      )
    }
  })
  tx(treatments)
}

// --- Applications -----------------------------------------------------------
export function listApplications(db: Database.Database = getDb()): Application[] {
  const rows = db
    .prepare(`SELECT * FROM application ORDER BY ordinal, id`)
    .all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    ordinal: (r.ordinal as number) ?? 0,
    timingCode: r.timing_code as string,
    targetGrowthStage: r.growth_stage as string,
    description: r.description as string
  }))
}

export function replaceApplications(apps: Application[], db: Database.Database = getDb()): void {
  const tx = db.transaction((items: Application[]) => {
    db.prepare('DELETE FROM application').run()
    const ins = db.prepare(
      `INSERT INTO application (ordinal, timing_code, growth_stage, description)
       VALUES (@ordinal, @timingCode, @targetGrowthStage, @description)`
    )
    items.forEach((a, i) => ins.run({ ...a, ordinal: a.ordinal ?? i }))
  })
  tx(apps)
}

// --- Application actuals (trial-owned) --------------------------------------
export function listApplicationActuals(db: Database.Database = getDb()): ApplicationActual[] {
  const rows = db
    .prepare(`SELECT * FROM application_actual ORDER BY timing_code`)
    .all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    timingCode: r.timing_code as string,
    actualDate: r.actual_date as string
  }))
}

export function replaceApplicationActuals(
  actuals: ApplicationActual[],
  db: Database.Database = getDb()
): void {
  const tx = db.transaction((items: ApplicationActual[]) => {
    db.prepare('DELETE FROM application_actual').run()
    const ins = db.prepare(
      `INSERT OR IGNORE INTO application_actual (timing_code, actual_date) VALUES (@timingCode, @actualDate)`
    )
    for (const a of items) if (a.timingCode) ins.run(a)
  })
  tx(actuals)
}

// --- Properties (trial-side key/value metadata) -----------------------------
export function listProperties(db: Database.Database = getDb()): Property[] {
  const rows = db
    .prepare(`SELECT * FROM property ORDER BY scope, scope_ref, id`)
    .all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    scope: r.scope as Property['scope'],
    scopeRef: (r.scope_ref as string) ?? '',
    key: r.key as string,
    value: r.value as string
  }))
}

/** Replace all properties for one scope+ref (leaving other scopes untouched). */
export function replaceProperties(
  scope: Property['scope'],
  scopeRef: string,
  props: Property[],
  db: Database.Database = getDb()
): void {
  const tx = db.transaction((items: Property[]) => {
    db.prepare('DELETE FROM property WHERE scope = ? AND scope_ref = ?').run(scope, scopeRef)
    const ins = db.prepare(
      `INSERT INTO property (scope, scope_ref, key, value) VALUES (@scope, @scopeRef, @key, @value)`
    )
    for (const p of items) if (p.key.trim()) ins.run({ scope, scopeRef, key: p.key, value: p.value })
  })
  tx(props)
}

// --- Measurement definitions (protocol-owned) --------------------------------
export function listMeasurementDefs(db: Database.Database = getDb()): MeasurementDef[] {
  const rows = db
    .prepare(`SELECT * FROM measurement_def ORDER BY ordinal, id`)
    .all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    partMeasured: r.part_measured as string,
    measurementType: r.measurement_type as string,
    measurementUnit: r.measurement_unit as string,
    applicationRef: (r.application_ref as string) ?? '',
    daysAfter: (r.days_after as number | null) ?? null,
    timing: r.timing as string,
    description: r.description as string,
    ordinal: r.ordinal as number,
    analyze: !!(r.analyze as number),
    subsamples: (r.subsamples as number) ?? 1,
    formula: (r.formula as string) ?? ''
  }))
}

export function replaceMeasurementDefs(defs: MeasurementDef[], db: Database.Database = getDb()): void {
  const tx = db.transaction((items: MeasurementDef[]) => {
    db.prepare('DELETE FROM measurement_def').run()
    const ins = db.prepare(
      `INSERT INTO measurement_def (part_measured, measurement_type, measurement_unit, application_ref, days_after, timing, description, ordinal, analyze, subsamples, formula)
       VALUES (@partMeasured, @measurementType, @measurementUnit, @applicationRef, @daysAfter, @timing, @description, @ordinal, @analyze, @subsamples, @formula)`
    )
    items.forEach((d, i) =>
      ins.run({
        ...d,
        applicationRef: d.applicationRef ?? '',
        daysAfter: d.daysAfter ?? null,
        ordinal: d.ordinal ?? i,
        analyze: d.analyze === false ? 0 : 1,
        subsamples: d.subsamples ?? 1,
        formula: d.formula ?? ''
      })
    )
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
  // `block` is optional here; complete-block designs (RCB/CRD) leave it out and it
  // defaults to the replicate. ALPHA layouts pass the incomplete-block index.
  plots: (Omit<Plot, 'id' | 'trialId' | 'excluded' | 'excludeReason' | 'block'> & {
    block?: number
  })[],
  db: Database.Database = getDb()
): number {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM trial').run() // cascades to plot / measurement_header / values
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
      `INSERT INTO plot (trial_id, plot_number, rep, block, treatment_id, map_row, map_col)
       VALUES (@trialId, @plotNumber, @rep, @block, @treatmentId, @mapRow, @mapCol)`
    )
    for (const p of plots) ins.run({ ...p, block: p.block ?? p.rep, trialId })
    return trialId
  })
  return tx()
}

/** Create the initial, unrandomized trial row for a new trial file (no layout yet, empty site). */
export function createEmptyTrial(db: Database.Database = getDb()): number {
  const info = db
    .prepare(`INSERT INTO trial (protocol_id, plot_rows, plot_cols, seed) VALUES (1, 0, 0, 0)`)
    .run()
  return info.lastInsertRowid as number
}

/** Update the site metadata columns on the trial row (independent of randomization). */
export function updateTrialSite(site: SiteMetadata, db: Database.Database = getDb()): void {
  const existing = getTrial(db)
  const id = existing?.id ?? createEmptyTrial(db)
  db.prepare(
    `UPDATE trial SET site_name=@siteName, operator=@operator, location=@location, city=@city,
       state=@state, country=@country, planting_date=@plantingDate, trial_notes=@trialNotes
     WHERE id=@id`
  ).run({ ...site, id })
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
    block: (r.block as number) ?? (r.rep as number),
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
    block: (r.block as number) ?? (r.rep as number),
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

/** Swap the treatment assignment of two plots ("hot edit"). */
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

/**
 * Move a plot to a grid cell (physical layout only — never touches treatment/rep/block/number, so
 * the randomization and analysis are unaffected). If another plot occupies the target cell, the two
 * swap positions; otherwise the plot moves to the (empty) cell.
 */
export function movePlotToCell(
  plotId: number,
  mapRow: number,
  mapCol: number,
  db: Database.Database = getDb()
): void {
  const tx = db.transaction(() => {
    const src = db.prepare('SELECT trial_id, map_row, map_col FROM plot WHERE id = ?').get(plotId) as
      | { trial_id: number; map_row: number; map_col: number }
      | undefined
    if (!src) throw new Error('Plot not found for move')
    const occupant = db
      .prepare('SELECT id FROM plot WHERE trial_id = ? AND map_row = ? AND map_col = ? AND id != ?')
      .get(src.trial_id, mapRow, mapCol, plotId) as { id: number } | undefined
    if (occupant) {
      db.prepare('UPDATE plot SET map_row = ?, map_col = ? WHERE id = ?').run(
        src.map_row,
        src.map_col,
        occupant.id
      )
    }
    db.prepare('UPDATE plot SET map_row = ?, map_col = ? WHERE id = ?').run(mapRow, mapCol, plotId)
  })
  tx()
}

/**
 * Re-flow every plot (in plotNumber order) into a grid `cols` wide and update the trial's
 * dimensions. Physical layout only. Used by the Columns control and Reset.
 */
export function reshapeLayout(cols: number, db: Database.Database = getDb()): void {
  if (!Number.isInteger(cols) || cols < 1) throw new Error('Columns must be a positive whole number.')
  const trial = getTrial(db)
  if (!trial) throw new Error('No trial to reshape.')
  const plots = db
    .prepare('SELECT id FROM plot WHERE trial_id = ? ORDER BY plot_number')
    .all(trial.id!) as { id: number }[]
  const tx = db.transaction(() => {
    const upd = db.prepare('UPDATE plot SET map_row = ?, map_col = ? WHERE id = ?')
    plots.forEach((p, i) => upd.run(Math.floor(i / cols), i % cols, p.id))
    db.prepare('UPDATE trial SET plot_cols = ?, plot_rows = ? WHERE id = ?').run(
      cols,
      Math.ceil(plots.length / cols),
      trial.id!
    )
  })
  tx()
}

// --- Measurements ------------------------------------------------------------
export function listMeasurementHeaders(
  trialId: number,
  db: Database.Database = getDb()
): MeasurementHeader[] {
  const rows = db
    .prepare(`SELECT * FROM measurement_header WHERE trial_id = ? ORDER BY ordinal, id`)
    .all(trialId) as Record<string, unknown>[]
  return rows.map(mapHeaderRow)
}

function mapHeaderRow(r: Record<string, unknown>): MeasurementHeader {
  return {
    id: r.id as number,
    trialId: r.trial_id as number,
    partMeasured: r.part_measured as string,
    measurementType: r.measurement_type as string,
    measurementUnit: r.measurement_unit as string,
    applicationRef: (r.application_ref as string) ?? '',
    daysAfter: (r.days_after as number | null) ?? null,
    timing: r.timing as string,
    description: r.description as string,
    ordinal: r.ordinal as number,
    origin: r.origin as MeasurementHeader['origin'],
    locked: !!(r.locked as number),
    analyze: !!(r.analyze as number),
    subsamples: (r.subsamples as number) ?? 1,
    formula: (r.formula as string) ?? '',
    // Event metadata (recorded at data entry):
    measurementDate: (r.measurement_date as string) ?? '',
    assessedBy: (r.assessed_by as string) ?? '',
    growthStage: (r.growth_stage as string) ?? ''
  }
}

export function upsertMeasurementHeader(
  h: MeasurementHeader,
  db: Database.Database = getDb()
): number {
  const extra = {
    locked: h.locked ? 1 : 0,
    analyze: h.analyze === false ? 0 : 1,
    subsamples: h.subsamples ?? 1,
    applicationRef: h.applicationRef ?? '',
    daysAfter: h.daysAfter ?? null,
    formula: h.formula ?? '',
    measurementDate: h.measurementDate ?? '',
    assessedBy: h.assessedBy ?? '',
    growthStage: h.growthStage ?? ''
  }
  if (h.id) {
    db.prepare(
      `UPDATE measurement_header SET part_measured=@partMeasured, measurement_type=@measurementType,
        measurement_unit=@measurementUnit, application_ref=@applicationRef, days_after=@daysAfter,
        timing=@timing, description=@description, ordinal=@ordinal, origin=@origin, locked=@locked,
        analyze=@analyze, subsamples=@subsamples, formula=@formula,
        measurement_date=@measurementDate, assessed_by=@assessedBy, growth_stage=@growthStage WHERE id=@id`
    ).run({ ...h, ...extra })
    return h.id
  }
  const info = db
    .prepare(
      `INSERT INTO measurement_header (trial_id, part_measured, measurement_type, measurement_unit, application_ref, days_after, timing, description, ordinal, origin, locked, analyze, subsamples, formula, measurement_date, assessed_by, growth_stage)
       VALUES (@trialId, @partMeasured, @measurementType, @measurementUnit, @applicationRef, @daysAfter, @timing, @description, @ordinal, @origin, @locked, @analyze, @subsamples, @formula, @measurementDate, @assessedBy, @growthStage)`
    )
    .run({ ...h, origin: h.origin ?? 'site', ...extra })
  return info.lastInsertRowid as number
}

/**
 * Update only the measurement *event* metadata (date performed, who, growth stage) on a header.
 * Allowed on any trial header — including protocol-defined (core, locked) columns — because this is
 * data collection, not editing the definition.
 */
export function updateMeasurementMetadata(
  id: number,
  meta: { measurementDate: string; assessedBy: string; growthStage: string },
  db: Database.Database = getDb()
): void {
  db.prepare(
    `UPDATE measurement_header SET measurement_date=@measurementDate, assessed_by=@assessedBy, growth_stage=@growthStage WHERE id=@id`
  ).run({ id, ...meta })
}

/** Look up a single header (used by guards to check origin before mutating). */
export function getMeasurementHeader(
  id: number,
  db: Database.Database = getDb()
): MeasurementHeader | null {
  const r = db.prepare(`SELECT * FROM measurement_header WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined
  return r ? mapHeaderRow(r) : null
}

export function deleteMeasurementHeader(id: number, db: Database.Database = getDb()): void {
  db.prepare('DELETE FROM measurement_header WHERE id = ?').run(id)
}

export function listMeasurementValues(
  trialId: number,
  db: Database.Database = getDb()
): MeasurementValue[] {
  const rows = db
    .prepare(
      `SELECT av.measurement_header_id, av.plot_id, av.subsample, av.value
       FROM measurement_value av
       JOIN plot p ON p.id = av.plot_id
       WHERE p.trial_id = ?`
    )
    .all(trialId) as Record<string, unknown>[]
  return rows.map((r) => ({
    measurementHeaderId: r.measurement_header_id as number,
    plotId: r.plot_id as number,
    subsample: (r.subsample as number) ?? 1,
    value: r.value as number | null
  }))
}

/** Read one subsample cell's current value (null if unset). Used to capture old→new for audit. */
export function getMeasurementValue(
  measurementHeaderId: number,
  plotId: number,
  subsample: number,
  db: Database.Database = getDb()
): number | null {
  const r = db
    .prepare(
      `SELECT value FROM measurement_value WHERE measurement_header_id = ? AND plot_id = ? AND subsample = ?`
    )
    .get(measurementHeaderId, plotId, subsample) as { value: number | null } | undefined
  return r ? r.value : null
}

/** Set (or clear) one subsample cell. A null value deletes the row. */
export function setMeasurementValue(v: MeasurementValue, db: Database.Database = getDb()): void {
  const subsample = v.subsample ?? 1
  if (v.value === null || Number.isNaN(v.value)) {
    db.prepare(
      'DELETE FROM measurement_value WHERE measurement_header_id = ? AND plot_id = ? AND subsample = ?'
    ).run(v.measurementHeaderId, v.plotId, subsample)
    return
  }
  db.prepare(
    `INSERT INTO measurement_value (measurement_header_id, plot_id, subsample, value)
     VALUES (@measurementHeaderId, @plotId, @subsample, @value)
     ON CONFLICT (measurement_header_id, plot_id, subsample) DO UPDATE SET value = excluded.value`
  ).run({ ...v, subsample })
}

// --- Analysis cache ---------------------------------------------------------
export function saveAnalysisResult(
  measurementHeaderId: number,
  engineVersion: string,
  params: unknown,
  result: unknown,
  db: Database.Database = getDb()
): void {
  db.prepare(
    `INSERT INTO analysis_result (measurement_header_id, engine_version, params_json, result_json)
     VALUES (?, ?, ?, ?)`
  ).run(measurementHeaderId, engineVersion, JSON.stringify(params), JSON.stringify(result))
}

// --- Create a trial from a protocol -----------------------------------------
/**
 * Create a new trial file at `destPath` from the protocol at `sourcePath`.
 * The protocol content (metadata, design, treatments, applications, measurement
 * defs) is copied verbatim — including protocol_uid/version, the identity used to
 * match the returned trial back to its protocol — and the file is stamped role='trial'
 * so the copy is locked. The trial layout itself is generated later (trial:generate).
 *
 * The source is read via a *separate* readonly handle; only after it is closed do we
 * call openProject(destPath), which replaces the process-global current handle.
 */
/** Read a protocol file's design parameters (readonly) without opening it as the current project. */
export function readDesignInfo(sourcePath: string): {
  design: Protocol['design']
  replicates: number
  blockSize: number
  treatmentCount: number
} {
  const src = new Database(sourcePath, { readonly: true })
  try {
    const p = getProtocol(src)
    return {
      design: p.design,
      replicates: p.replicates,
      blockSize: p.blockSize,
      treatmentCount: listTreatments(src).length
    }
  } finally {
    src.close()
  }
}

export function createTrialFromProtocol(sourcePath: string, destPath: string): void {
  const src = new Database(sourcePath, { readonly: true })
  let protocol: Protocol
  let treatments: Treatment[]
  let applications: Application[]
  let defs: MeasurementDef[]
  let library: LibraryTerm[]
  try {
    protocol = getProtocol(src)
    treatments = listTreatments(src)
    applications = listApplications(src)
    defs = listMeasurementDefs(src)
    library = listLibraryTerms(src)
  } finally {
    src.close()
  }

  openProject(destPath, { role: 'trial', create: true })
  saveProtocol(protocol, getDb(), protocol.protocolUid)
  replaceTreatments(treatments)
  replaceApplications(applications)
  replaceMeasurementDefs(defs)
  // The author's vocabulary snapshot travels so the operator sees the same terms/labels.
  replaceLibraryTerms(library)
  // Create the trial row up front (unrandomized) so Site/Applications can be filled in before the
  // layout is generated; materialize the core measurement columns onto it.
  const trialId = createEmptyTrial()
  materializeCoreHeaders(trialId)
}

/** Materialize the protocol's core measurement defs as locked headers on a trial. */
export function materializeCoreHeaders(trialId: number, db: Database.Database = getDb()): void {
  const defs = listMeasurementDefs(db)
  defs.forEach((d, i) => {
    upsertMeasurementHeader(
      {
        trialId,
        partMeasured: d.partMeasured,
        measurementType: d.measurementType,
        measurementUnit: d.measurementUnit,
        applicationRef: d.applicationRef,
        daysAfter: d.daysAfter,
        timing: d.timing,
        description: d.description,
        ordinal: d.ordinal ?? i,
        origin: 'core',
        locked: true,
        analyze: d.analyze,
        subsamples: d.subsamples ?? 1,
        formula: d.formula ?? '',
        // Event metadata (date / assessor / growth stage) is captured at data entry, not here.
        measurementDate: '',
        assessedBy: '',
        growthStage: ''
      },
      db
    )
  })
}

// --- Library snapshot (per-project; travels into trials) --------------------
export function listLibraryTerms(db: Database.Database = getDb()): LibraryTerm[] {
  const rows = db
    .prepare(`SELECT * FROM library_term ORDER BY category, value`)
    .all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    category: r.category as LibraryTerm['category'],
    value: r.value as string,
    label: r.label as string
  }))
}

/** Replace the whole embedded snapshot in one transaction. */
export function replaceLibraryTerms(terms: LibraryTerm[], db: Database.Database = getDb()): void {
  const tx = db.transaction((items: LibraryTerm[]) => {
    db.prepare('DELETE FROM library_term').run()
    const ins = db.prepare(
      `INSERT OR IGNORE INTO library_term (category, value, label) VALUES (@category, @value, @label)`
    )
    for (const t of items) ins.run({ category: t.category, value: t.value, label: t.label ?? '' })
  })
  tx(terms)
}

/** Every coded term the current document references (deduped), for rebuilding the snapshot. */
export function collectDocumentTerms(db: Database.Database = getDb()): TermRef[] {
  const trial = getTrial(db)
  const refs: TermRef[] = [
    ...extractProtocol(getProtocol(db)),
    ...extractTreatments(listTreatments(db)),
    ...extractApplications(listApplications(db)),
    ...extractMeasurementDefs(listMeasurementDefs(db)),
    ...extractProperties(listProperties(db)),
    ...(trial ? extractMeasurementHeaders(listMeasurementHeaders(trial.id!, db)) : [])
  ]
  return dedupeTerms(refs)
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
    measurementDefs: listMeasurementDefs(db),
    trial,
    plots: trial ? listPlots(trial.id!, db) : [],
    measurementHeaders: trial ? listMeasurementHeaders(trial.id!, db) : [],
    measurementValues: trial ? listMeasurementValues(trial.id!, db) : [],
    applicationActuals: listApplicationActuals(db),
    properties: listProperties(db),
    libraryTerms: listLibraryTerms(db)
  }
}
