-- ART schema. One SQLite file is either a PROTOCOL (authored template) or a
-- TRIAL (a locally implemented instance of a protocol). meta.role selects which.
--   protocol file: protocol + treatment + application + measurement_def (no trial/plots)
--   trial file:    a locked copy of the protocol tables + one trial + plots + data
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- The protocol definition. Owns the experimental design (design/replicates/plot
-- dimensions) and the core measurement schedule. In a trial file this is a locked
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
  design           TEXT NOT NULL DEFAULT 'RCB' CHECK (design IN ('RCB', 'CRD', 'ALPHA')),
  replicates       INTEGER NOT NULL DEFAULT 4,
  block_size       INTEGER NOT NULL DEFAULT 2, -- incomplete-block size (k) for the ALPHA design
  plot_width       REAL NOT NULL DEFAULT 0,
  plot_length      REAL NOT NULL DEFAULT 0
);

-- Snapshot of the coded terms this document references (crop, measurement types, units, …).
-- Populated as coded fields are saved and copied into a trial by createTrialFromProtocol, so
-- the author's vocabulary (values + labels) travels to the operator on any machine. The author's
-- accumulating *personal* library lives outside the project file (app userData).
CREATE TABLE IF NOT EXISTS library_term (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  value    TEXT NOT NULL,
  label    TEXT NOT NULL DEFAULT '',
  UNIQUE (category, value)
);

-- A treatment is the comparison unit; its product/rate/timing content lives in treatment_application
-- (the program). product/rate/rate_unit columns are legacy (pre-program model) and left for
-- back-compat but no longer read/written.
CREATE TABLE IF NOT EXISTS treatment (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  number    INTEGER NOT NULL,
  name      TEXT NOT NULL DEFAULT '',
  product   TEXT NOT NULL DEFAULT '',
  rate      TEXT NOT NULL DEFAULT '',
  rate_unit TEXT NOT NULL DEFAULT '',
  type      TEXT NOT NULL DEFAULT '',
  is_check  INTEGER NOT NULL DEFAULT 0, -- untreated check (for calculated measurements' % control)
  UNIQUE (number)
);

-- One line of a treatment's program: a product + rate applied at an application timing (A/B/C, or
-- '' for unscheduled). A treatment can have several — the sequence that defines the program.
CREATE TABLE IF NOT EXISTS treatment_application (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  treatment_id    INTEGER NOT NULL REFERENCES treatment(id) ON DELETE CASCADE,
  ordinal         INTEGER NOT NULL DEFAULT 0,
  application_ref TEXT NOT NULL DEFAULT '', -- application timing code (matches application), '' = unscheduled
  product         TEXT NOT NULL DEFAULT '',
  rate            TEXT NOT NULL DEFAULT '',
  rate_unit       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_trtappl_treatment ON treatment_application(treatment_id);

-- Protocol-defined applications (the *plan*): ordered A/B/C… events, each a timing code + intended
-- crop growth stage. Measurements anchor their timing to these (measurement_def.application_ref). The
-- actual date each happened is trial-side (application_actual) — one protocol serves many sites.
CREATE TABLE IF NOT EXISTS application (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ordinal      INTEGER NOT NULL DEFAULT 0,
  timing_code  TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  planned_date TEXT NOT NULL DEFAULT '',  -- deprecated (actual date is trial-side); kept for back-compat
  growth_stage TEXT NOT NULL DEFAULT ''   -- intended (target) crop growth stage at this application
);

-- Trial-side record of when each application actually happened, keyed by the plan's timing code.
CREATE TABLE IF NOT EXISTS application_actual (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timing_code TEXT NOT NULL DEFAULT '',
  actual_date TEXT NOT NULL DEFAULT '',
  UNIQUE (timing_code)
);

-- Generic trial-side key/value metadata (the one mechanism that absorbs ad-hoc detail without a
-- wall of columns — see docs/DESIGN-PRINCIPLES.md). scope='trial' → site details (scope_ref='');
-- scope='application' → conditions for an application (scope_ref = the timing code). Keys come from
-- the property_key library; consumed by the printed documents.
CREATE TABLE IF NOT EXISTS property (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  scope     TEXT NOT NULL DEFAULT 'trial',
  scope_ref TEXT NOT NULL DEFAULT '',
  key       TEXT NOT NULL DEFAULT '',
  value     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_property_scope ON property(scope, scope_ref);

-- Core measurement definitions authored in the protocol. In a trial file these are
-- materialized into measurement_header (origin='core', locked=1) when the layout is
-- generated, so operators can enter values but not edit/remove them.
CREATE TABLE IF NOT EXISTS measurement_def (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  part_measured  TEXT NOT NULL DEFAULT '',
  measurement_type TEXT NOT NULL DEFAULT '',
  measurement_unit TEXT NOT NULL DEFAULT '',
  application_ref TEXT NOT NULL DEFAULT '', -- anchored application's timing code ('' = unanchored)
  days_after  INTEGER,                      -- offset from the anchored application (NULL = unanchored)
  timing      TEXT NOT NULL DEFAULT '',     -- free-text timing override (wins over the derived label)
  measurement_date TEXT NOT NULL DEFAULT '',     -- legacy (unused); measurement event date lives on the header
  description TEXT NOT NULL DEFAULT '',
  ordinal     INTEGER NOT NULL DEFAULT 0,
  analyze     INTEGER NOT NULL DEFAULT 1, -- include in ANOVA / report
  subsamples  INTEGER NOT NULL DEFAULT 1, -- measurements recorded per plot (>1 = averaged)
  formula     TEXT NOT NULL DEFAULT ''    -- non-empty = calculated column (derived from other measurements)
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
  block        INTEGER NOT NULL DEFAULT 0, -- incomplete block within the rep (ALPHA); = rep otherwise
  treatment_id INTEGER NOT NULL REFERENCES treatment(id) ON DELETE CASCADE,
  map_row      INTEGER NOT NULL,
  map_col      INTEGER NOT NULL,
  excluded     INTEGER NOT NULL DEFAULT 0,   -- flagged out of analysis (data retained)
  exclude_reason TEXT NOT NULL DEFAULT '',
  UNIQUE (trial_id, plot_number)
);
CREATE INDEX IF NOT EXISTS idx_plot_trial ON plot(trial_id);

-- Measurement columns for a trial. origin distinguishes protocol-defined 'core'
-- columns (locked=1, mirror of measurement_def) from operator-added 'site' columns.
CREATE TABLE IF NOT EXISTS measurement_header (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trial_id    INTEGER NOT NULL REFERENCES trial(id) ON DELETE CASCADE,
  part_measured  TEXT NOT NULL DEFAULT '',
  measurement_type TEXT NOT NULL DEFAULT '',
  measurement_unit TEXT NOT NULL DEFAULT '',
  application_ref TEXT NOT NULL DEFAULT '', -- anchored application's timing code ('' = unanchored)
  days_after  INTEGER,                      -- offset from the anchored application (NULL = unanchored)
  timing      TEXT NOT NULL DEFAULT '',     -- free-text timing override (wins over the derived label)
  description TEXT NOT NULL DEFAULT '',
  ordinal     INTEGER NOT NULL DEFAULT 0,
  origin      TEXT NOT NULL DEFAULT 'site' CHECK (origin IN ('core', 'site')),
  locked      INTEGER NOT NULL DEFAULT 0,
  analyze     INTEGER NOT NULL DEFAULT 1, -- include in ANOVA / report
  subsamples  INTEGER NOT NULL DEFAULT 1, -- measurements recorded per plot (>1 = averaged)
  formula     TEXT NOT NULL DEFAULT '',  -- non-empty = calculated column (derived from other measurements)
  -- Event metadata, recorded at data entry (not authoring):
  measurement_date  TEXT NOT NULL DEFAULT '',   -- date the measurement was performed
  assessed_by  TEXT NOT NULL DEFAULT '',   -- who performed it
  growth_stage TEXT NOT NULL DEFAULT ''    -- crop growth stage observed
);
CREATE INDEX IF NOT EXISTS idx_header_trial ON measurement_header(trial_id);

CREATE TABLE IF NOT EXISTS measurement_value (
  measurement_header_id INTEGER NOT NULL REFERENCES measurement_header(id) ON DELETE CASCADE,
  plot_id              INTEGER NOT NULL REFERENCES plot(id) ON DELETE CASCADE,
  subsample            INTEGER NOT NULL DEFAULT 1, -- 1-based; 1 = the single/default measurement
  value                REAL,
  PRIMARY KEY (measurement_header_id, plot_id, subsample)
);

CREATE TABLE IF NOT EXISTS analysis_result (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  measurement_header_id INTEGER NOT NULL REFERENCES measurement_header(id) ON DELETE CASCADE,
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
  action  TEXT NOT NULL DEFAULT '',   -- machine code, e.g. measurement.value.set
  entity  TEXT NOT NULL DEFAULT '',   -- subject, e.g. measurement_value
  summary TEXT NOT NULL DEFAULT '',   -- human-readable one-liner incl. old -> new
  detail  TEXT NOT NULL DEFAULT '{}'  -- JSON: structured old/new/context
);
