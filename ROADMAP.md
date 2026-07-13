# ART Roadmap

ART is an open-source, cross-platform alternative to [ARM](https://gdmdata.com/products/arm)
(Agricultural Research Manager) — the long-standing commercial standard for planning, randomizing,
collecting, and analyzing agricultural field trials. This document sets out where ART is today, an
honest gap analysis against ARM, and the path to a credible **v1.0 MVP**.

**MVP scope:** a single-trial, single-user desktop application. The v1.0 focus is deliberately narrow
— **(A) richer, field-relevant metadata capture** and **(B) printing the labels and documents a
researcher actually needs in the field**. Statistics depth, more designs, multi-trial summaries, and
tablet collection are real goals, but they come *after* the core trial can be planned, taken to the
field, recorded, and reported on paper.

## Guided by the design principles

This roadmap looks different from ARM's feature list on purpose. ART is governed by
[`docs/DESIGN-PRINCIPLES.md`](docs/DESIGN-PRINCIPLES.md), whose central rule is the **consumer test**:

> **A field earns a dedicated box only if the software itself consumes it** — the randomizer, the
> analysis engine, the trial map, data entry, or a report/print reads the value and *does something*
> with it. A field that exists only so a human can read it back later is a note, not a box.

The incumbent tools grew, one reasonable request at a time, into walls of mostly-empty form fields.
ART says yes to metadata a different way:

- **Printing is a consumer.** A value that renders on a label, data sheet, or summary document is
  genuinely used — so the printing work (Theme B) is what *earns* the metadata capture (Theme A).
  They ship together.
- **Ad-hoc metadata → one generic property mechanism, not new columns.** "Additional site details"
  and "conditions at application" (soil, previous crop, wind, nozzle, operator…) are captured as
  library-keyed key/value **properties**, never a pile of speculative columns.
- **Derive, don't box** (e.g. "days after application" is computed, not typed).
- **Import or attach, never transcribe** (weather/GPS/lab data), and **compliance is a log, not a
  form** (the append-only audit trail, not more fields).

## Where we are today (shipped)

- ✅ **Protocol editor** — metadata, treatments, core assessments; live experimental-design
  conformance validation.
- ✅ **Randomization** — Randomized Complete Block, Completely Randomized, and resolvable Incomplete
  Block (alpha) designs (R + `agricolae`), with non-conformant alpha designs blocked at authoring.
- ✅ **Protocol → trial distribution** — a protocol is authored once and run at many sites, each
  generating its own randomization.
- ✅ **Field/trial map** — square-cell grid with bottom-left origin, reshape (columns) and
  drag-to-rearrange, colour-by treatment/rep/block, analysis-safe treatment swaps, alpha block
  boundaries, plot exclusion, and layout lock.
- ✅ **Assessment columns + data entry** — spreadsheet grid (rows = plots, columns = assessments)
  with subsamples and paste-from-clipboard.
- ✅ **Statistics** — one-/two-way ANOVA + LSD / Tukey / Duncan / SNK mean comparisons (PBIB
  block-adjusted for alpha), with separation letters, CV, grand mean, and critical values.
- ✅ **Report** — protocol summary, treatment-means table, bar chart with error bars; export to PDF
  and CSV.
- ✅ **GEP/GLP audit trail** — append-only, attributed edit log stored in the trial file.
- ✅ **Coded-field library** — crop-aware, user-curated vocabulary for coded fields; travels with the
  protocol; import/export.
- ✅ **Engineering** — TypeScript, tests, ESLint, and CI.

## Gap vs ARM

| Area | ARM | ART today | Roadmap tier |
|---|---|---|---|
| Experimental designs | RCB, CRD, Latin square, factorial, split-plot, strip-block, split-block-by-application, non-randomized | RCB, CRD, resolvable alpha | v2 |
| Treatment applications | Timing schedule (A/B/C), dates, growth stage, method, spray volume/mix, operator; assessments reference applications | `application` table exists but is **unused** (no UI, no consumer) | **v1.0** |
| Assessment metadata | Assessment date, growth stage at assessment, days-after-treatment, rater, sample size | Rating type/part/unit/timing/date/subsamples | **v1.0** |
| Site / trial details | Extensive (soil, plot dims, row spacing, previous crop, variety, planting rate, GPS…) | Name/operator/location/date/notes; plot dimensions | **v1.0** (via property mechanism) |
| Printing | Plot signs, data-collection sheets, protocol/trial reports, plot maps | Analysis report only (PDF/CSV) | **v1.0** |
| Product & rate handling | Product-to-apply, spray volume, mix size, % formulations, seed treatment, unit conversion | Rate + unit as text | v1.1 |
| Statistics depth | Transformations (arcsine√, log, √, Abbott's, Henderson-Tilton), homogeneity test, Yates missing-plot, dose-response, correlation | Base ANOVA + mean comparisons | v1.1 / v2 |
| Reporting/interop | Modular reports, treatment-subset, box-whisker/line graphs, Word/Excel export, data-collector import | Fixed report, bar chart, PDF/CSV | v1.1 |
| Standards | EPPO codes, BBCH/VR/Feekes growth stages, SART | User-curated library (accretes from use) | v1.1 (BBCH seed) |
| Multi-trial summary | ARM ST — combine/average across sites & years | — | v2 |
| Tablet/field collection | ARM Mobile / TDCx — offline entry into the trial | — | v2 |

## v1.0 — MVP

The two focus themes ship together: **the printed documents are the consumers that justify the
metadata**. Every item below names what consumes it.

### Theme A — Metadata capture

| # | Item | Consumer / rationale | Size |
|---|---|---|---|
| A1 | **Applications model + editor** | Make **assessment timing anchor to an application** so a schedule like "14 DA-A" is *derived* from application A's date (consumed by data sheets + report). The protocol defines the timing *structure* (application code + target growth stage); the **actual date is trial-side**. This gives the currently-dead `application` table a real consumer — otherwise the table should be removed, not fitted with empty boxes. | M |
| A2 | **Assessment date + growth stage** | Add assessment date and crop growth stage (from the library) to assessment headers — both render on data sheets and the report. Days-after-application is **derived**, not stored. Rater/sample-size stay as notes/library terms, not new boxes. | S |
| A3 | **Generic property mechanism (site details + application conditions)** | One library-keyed `property(scope, key, value)` mechanism, scoped to the **trial** (soil, previous crop, variety…) or a specific **application** (temperature, wind, nozzle, operator…). No dedicated weather/equipment columns — the design doc's named anti-pattern. Consumed by printing (summary/data-sheet header; application record). | M |

### Theme B — Printing labels & documents (the consumers)

| # | Item | Rationale | Size |
|---|---|---|---|
| B1 | **Printable field/trial map** | The plot layout as a standalone, paginated print for walking the field (reuses the trial-map render via print CSS). | M |
| B2 | **Plot labels / field signs** | Printable plot labels (plot #, rep, treatment, trial) at stake-label and large field-tour sizes, laid out N-up. | M |
| B3 | **Data-collection sheets** | Blank/pre-filled assessment forms — plots in field order × assessment columns, with a metadata header (crop, timings, growth stage, date, site properties) — to record data in the field. | M |
| B4 | **Protocol / trial summary document** | A clean one/two-pager: metadata + site properties, treatments + rates, application schedule, assessment plan, and the field map — for approval and the trial book. | M |
| B5 | **Application / spray record** | A GEP application record per application: treatments + rates, actual date, target/actual growth stage, and the recorded condition properties. The consumer that earns application-condition capture. | S |

### Release readiness (v1.0 checklist)

- Signed/packaged installers (Windows / macOS / Linux via electron-builder).
- A first-run **sample trial** so a new user sees the full workflow immediately.
- Clearer R setup (guided install; consider a bundled/portable R later).

## v1.1 — near-term

- **Product & rate calculations** — spray volume, mix size, product-to-apply, % formulations, unit
  conversion (this is what *consumes* application spray-volume/method fields, so they land here).
- **ANOVA transformations** — arcsine√, log, √, Abbott's / % of untreated, Henderson-Tilton.
- **Report polish** — treatment-subset selection, box-whisker/line graphs, Word/Excel export.
- **Non-analyzable / text data columns**; homogeneity-of-variance surfaced; Yates missing-plot.
- **BBCH growth-stage seed** for the library (+ optional EPPO import path).

## v2 — post-MVP

- **Summary across trials** — multi-site / multi-year meta-analysis (ARM ST equivalent). This is
  where covariates (location, year, environment) genuinely earn structure — the consumer test working
  as intended.
- **Tablet / field data collector** — offline entry syncing into the trial.
- **More designs** — Latin square, factorial, split-plot, strip-block.
- **Dose-response** (Probit/Logit) and correlation reports.

## Later / exploratory

Cloud sync & multi-user; master/team validation lists; weather & spray-record import; bundled or
portable R for a zero-dependency install; import from ARM and third-party trial formats.

## Non-goals (for now)

ART is not trying to match ARM box-for-box. It will not grow a wall of speculative metadata fields:
new fields must pass the consumer test, ad-hoc metadata lives in notes / the library / the property
mechanism, and data that exists elsewhere is imported or attached rather than re-keyed. See
[`docs/DESIGN-PRINCIPLES.md`](docs/DESIGN-PRINCIPLES.md).
