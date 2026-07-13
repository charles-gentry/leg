import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openProject, closeProject, getDb } from './connection.js'
import * as dao from './dao.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'art-migrate-'))
})
afterEach(() => {
  closeProject()
  rmSync(dir, { recursive: true, force: true })
})

describe('schema migration v3 → v4', () => {
  it('adds the application/assessment anchor columns to an existing pre-v4 file', () => {
    const path = join(dir, 'legacy.artproto')
    // Hand-build a v3-style file: application has no `ordinal`; assessment_def has no anchor columns.
    const db = new Database(path)
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE application (id INTEGER PRIMARY KEY AUTOINCREMENT, timing_code TEXT DEFAULT '',
        description TEXT DEFAULT '', planned_date TEXT DEFAULT '', growth_stage TEXT DEFAULT '');
      CREATE TABLE assessment_def (id INTEGER PRIMARY KEY AUTOINCREMENT, part_rated TEXT DEFAULT '',
        rating_type TEXT DEFAULT '', rating_unit TEXT DEFAULT '', timing TEXT DEFAULT '',
        rating_date TEXT DEFAULT '', description TEXT DEFAULT '', ordinal INTEGER DEFAULT 0,
        analyze INTEGER DEFAULT 1, subsamples INTEGER DEFAULT 1);
    `)
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '3')").run()
    db.prepare("INSERT INTO application (timing_code, growth_stage) VALUES ('A', 'BBCH 30')").run()
    db.prepare("INSERT INTO assessment_def (rating_type) VALUES ('CONTRO')").run()
    db.close()

    // Opening runs migrate() → the new columns and application_actual table appear.
    openProject(path)
    const cols = (t: string): string[] =>
      (getDb().prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
    expect(cols('application')).toContain('ordinal')
    expect(cols('assessment_def')).toEqual(expect.arrayContaining(['application_ref', 'days_after']))

    // Existing rows survive and read back through the DAO with defaults for the new fields.
    const apps = dao.listApplications()
    expect(apps[0].timingCode).toBe('A')
    expect(apps[0].targetGrowthStage).toBe('BBCH 30')
    expect(apps[0].ordinal).toBe(0)
    const defs = dao.listAssessmentDefs()
    expect(defs[0].applicationRef).toBe('')
    expect(defs[0].daysAfter).toBeNull()
    // application_actual (new table) is now present.
    expect(dao.listApplicationActuals()).toEqual([])
  })
})
