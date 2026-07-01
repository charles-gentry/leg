-- Open ARM schema. One SQLite file is either a PROTOCOL (authored template) or a
-- TRIAL (a locally implemented instance of a protocol). meta.role selects which.
--   protocol file: protocol + treatment + application + assessment_def (no trial/plots)
--   trial file:    a locked copy of the protocol tables + one trial + plots + data
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- The protocol definition. Owns the experimental design (design/replicates/plot
-- dimensions) and the core assessment schedule. In a trial file this is a locked
-- copy of the source protocol; protocol_uid/version identify which protocol it came
-- from so returned trials can be matched back to the author's protocol.
CREATE TABLE IF NOT EXISTS protocol (
  id               INTEGER PRIMARY KEY CHECK (id = 1), -- single protocol per file
  protocol_uid     TEXT NOT NULL DEFAULT '',
  protocol_version INTEGER NOT NULL DEFAULT 1,
  title            TEXT NOT NULL DEFAULT '',
  crop             TEXT NOT NULL DEFAULT '',
  target_pest      TEXT NOT NULL DEFAULT '',
  objective        TEXT NOT NULL DEFAULT '',
  investigator     TEXT NOT NULL DEFAULT '',
  season           TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  design           TEXT NOT NULL DEFAULT 'RCB' CHECK (design IN ('RCB', 'CRD')),
  replicates       INTEGER NOT NULL DEFAULT 4,
  plot_width       REAL NOT NULL DEFAULT 0,
  plot_length      REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS treatment (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  number    INTEGER NOT NULL,
  name      TEXT NOT NULL DEFAULT '',
  product   TEXT NOT NULL DEFAULT '',
  rate      TEXT NOT NULL DEFAULT '',
  rate_unit TEXT NOT NULL DEFAULT '',
  type      TEXT NOT NULL DEFAULT '',
  UNIQUE (number)
);

CREATE TABLE IF NOT EXISTS application (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  timing_code  TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  planned_date TEXT NOT NULL DEFAULT '',
  growth_stage TEXT NOT NULL DEFAULT ''
);

-- Core assessment definitions authored in the protocol. In a trial file these are
-- materialized into assessment_header (origin='core', locked=1) when the layout is
-- generated, so operators can enter values but not edit/remove them.
CREATE TABLE IF NOT EXISTS assessment_def (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  part_rated  TEXT NOT NULL DEFAULT '',
  rating_type TEXT NOT NULL DEFAULT '',
  rating_unit TEXT NOT NULL DEFAULT '',
  timing      TEXT NOT NULL DEFAULT '',
  rating_date TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  ordinal     INTEGER NOT NULL DEFAULT 0,
  analyze     INTEGER NOT NULL DEFAULT 1 -- include in ANOVA / report
);

-- The local trial instance. design/replicates/plot dimensions live on the protocol;
-- the trial owns only the site-specific randomization (seed + generated grid) and the
-- site/operator metadata.
CREATE TABLE IF NOT EXISTS trial (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  protocol_id  INTEGER NOT NULL DEFAULT 1 REFERENCES protocol(id) ON DELETE CASCADE,
  plot_rows    INTEGER NOT NULL,
  plot_cols    INTEGER NOT NULL,
  seed         INTEGER NOT NULL,
  site_name    TEXT NOT NULL DEFAULT '',
  operator     TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  state        TEXT NOT NULL DEFAULT '',
  country      TEXT NOT NULL DEFAULT '',
  planting_date TEXT NOT NULL DEFAULT '',
  trial_notes  TEXT NOT NULL DEFAULT '',
  layout_locked_at TEXT NOT NULL DEFAULT '' -- ISO timestamp; empty = draft (unlocked)
);

CREATE TABLE IF NOT EXISTS plot (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  trial_id     INTEGER NOT NULL REFERENCES trial(id) ON DELETE CASCADE,
  plot_number  INTEGER NOT NULL,
  rep          INTEGER NOT NULL,
  treatment_id INTEGER NOT NULL REFERENCES treatment(id) ON DELETE CASCADE,
  map_row      INTEGER NOT NULL,
  map_col      INTEGER NOT NULL,
  excluded     INTEGER NOT NULL DEFAULT 0,   -- flagged out of analysis (data retained)
  exclude_reason TEXT NOT NULL DEFAULT '',
  UNIQUE (trial_id, plot_number)
);
CREATE INDEX IF NOT EXISTS idx_plot_trial ON plot(trial_id);

-- Assessment columns for a trial. origin distinguishes protocol-defined 'core'
-- columns (locked=1, mirror of assessment_def) from operator-added 'site' columns.
CREATE TABLE IF NOT EXISTS assessment_header (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trial_id    INTEGER NOT NULL REFERENCES trial(id) ON DELETE CASCADE,
  part_rated  TEXT NOT NULL DEFAULT '',
  rating_type TEXT NOT NULL DEFAULT '',
  rating_unit TEXT NOT NULL DEFAULT '',
  timing      TEXT NOT NULL DEFAULT '',
  rating_date TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  ordinal     INTEGER NOT NULL DEFAULT 0,
  origin      TEXT NOT NULL DEFAULT 'site' CHECK (origin IN ('core', 'site')),
  locked      INTEGER NOT NULL DEFAULT 0,
  analyze     INTEGER NOT NULL DEFAULT 1 -- include in ANOVA / report
);
CREATE INDEX IF NOT EXISTS idx_header_trial ON assessment_header(trial_id);

CREATE TABLE IF NOT EXISTS assessment_value (
  assessment_header_id INTEGER NOT NULL REFERENCES assessment_header(id) ON DELETE CASCADE,
  plot_id              INTEGER NOT NULL REFERENCES plot(id) ON DELETE CASCADE,
  value                REAL,
  PRIMARY KEY (assessment_header_id, plot_id)
);

CREATE TABLE IF NOT EXISTS analysis_result (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_header_id INTEGER NOT NULL REFERENCES assessment_header(id) ON DELETE CASCADE,
  engine_version       TEXT NOT NULL DEFAULT '',
  params_json          TEXT NOT NULL DEFAULT '{}',
  result_json          TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- GEP/GLP audit trail. Append-only: the app never updates or deletes rows and
-- exposes no edit UI. One row per data-changing action, attributed to the OS
-- account, stored inside the file so it travels with the record.
CREATE TABLE IF NOT EXISTS audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), -- UTC ISO
  actor   TEXT NOT NULL DEFAULT '',   -- OS username
  role    TEXT NOT NULL DEFAULT '',   -- protocol | trial at time of change
  action  TEXT NOT NULL DEFAULT '',   -- machine code, e.g. assessment.value.set
  entity  TEXT NOT NULL DEFAULT '',   -- subject, e.g. assessment_value
  summary TEXT NOT NULL DEFAULT '',   -- human-readable one-liner incl. old -> new
  detail  TEXT NOT NULL DEFAULT '{}'  -- JSON: structured old/new/context
);
