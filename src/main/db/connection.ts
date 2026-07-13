import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import type { Role } from '@shared/types.js'
import schemaSql from './schema.sql?raw'

const SCHEMA_VERSION = 4

/**
 * Add a column to an existing table if it isn't already present. `CREATE TABLE IF NOT EXISTS`
 * only reaches new *tables*; a new *column* on an existing file needs an explicit ALTER. Use
 * this in `migrate()` for any future column additions so old project files stay readable.
 */
export function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}

/**
 * Bring an existing file up to the current schema version. New tables are handled by
 * `schema.sql` (CREATE TABLE IF NOT EXISTS); this runs the ordered column/data migrations that
 * can't express, then records the version. No column migrations exist yet — the mechanism is in
 * place for the next one.
 */
function migrate(db: Database.Database): void {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined
  const from = row ? Number(row.value) : 0
  if (from >= SCHEMA_VERSION) return
  // v4: applications became the protocol timing plan (add ordinal); a treatment is a *program* of
  // application lines (new treatment_application table); assessments anchor their timing to an
  // application. New tables (treatment_application, application_actual) come from schema.sql's
  // CREATE TABLE IF NOT EXISTS; only pre-existing tables need column ALTERs here.
  if (from < 4) {
    ensureColumn(db, 'application', 'ordinal', 'ordinal INTEGER NOT NULL DEFAULT 0')
    for (const t of ['assessment_def', 'assessment_header']) {
      ensureColumn(db, t, 'application_ref', "application_ref TEXT NOT NULL DEFAULT ''")
      ensureColumn(db, t, 'days_after', 'days_after INTEGER')
    }
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(String(SCHEMA_VERSION))
}

/**
 * Opens (or creates) an ART SQLite file and ensures the schema is applied.
 * A file is either a protocol (authored template) or a trial (local instance);
 * meta.role records which. A single Database handle is held per process; opening
 * a new file closes the previous one.
 */
let current: Database.Database | null = null
let currentPath: string | null = null
let currentRole: Role = 'protocol'

export interface OpenOptions {
  /** Role to stamp on a freshly created file. Ignored when opening an existing file. */
  role?: Role
  /** When true, a new file is being created (seed the protocol row + meta). */
  create?: boolean
}

export function openProject(filePath: string, opts: OpenOptions = {}): Database.Database {
  closeProject()
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)

  // Ensure the singleton protocol row exists (with a stable uid), then apply any migrations.
  db.prepare(
    `INSERT OR IGNORE INTO protocol (id, protocol_uid, protocol_version) VALUES (1, ?, 1)`
  ).run(randomUUID())
  migrate(db)
  if (opts.create && opts.role) {
    db.prepare(
      `INSERT INTO meta (key, value) VALUES ('role', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    ).run(opts.role)
  }

  const roleRow = db.prepare(`SELECT value FROM meta WHERE key = 'role'`).get() as
    | { value: string }
    | undefined
  currentRole = roleRow?.value === 'trial' ? 'trial' : 'protocol'

  current = db
  currentPath = filePath
  return db
}

export function getDb(): Database.Database {
  if (!current) throw new Error('No project is open')
  return current
}

export function getCurrentPath(): string | null {
  return currentPath
}

export function getRole(): Role {
  return currentRole
}

export function closeProject(): void {
  if (current) {
    current.close()
    current = null
    currentPath = null
    currentRole = 'protocol'
  }
}
