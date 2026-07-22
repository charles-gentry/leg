# ART

An open-source **Agricultural Research Tool** — a cross-platform desktop app for planning,
randomizing, collecting, and analyzing agricultural field trials, covering the full workflow:

**Protocol → randomized Trial → Trial Map → Measurement data → ANOVA → Report.**

Built with Electron + React + TypeScript, with a SQLite file per project and an embedded **R**
statistics engine (via the [`agricolae`](https://cran.r-project.org/package=agricolae) package).

## Screenshots

|  |  |
| :--: | :--: |
| **Trial map** — visual plot grid, colour-by treatment/rep/block, with click-to-swap hot editing. | **Data entry** — one row per plot; calculated columns (ƒ) derive live from other measurements. |
| ![Trial map](docs/screenshots/trial-map.png) | ![Data entry](docs/screenshots/data-entry.png) |
| **Statistics** — ANOVA with mean-comparison letters (Fisher's LSD / Tukey / Duncan / SNK). | **Report** — protocol summary, treatment programs, and per-measurement analysis. |
| ![Statistics](docs/screenshots/statistics.png) | ![Report](docs/screenshots/report.png) |

## Features (MVP)

- **Protocol editor** — trial metadata, treatment programs (each treatment is an ordered sequence of
  product/rate/timing application lines), and a planned application schedule (A/B/C timings with a
  target growth stage) that measurements anchor to.
- **Randomized trial generation** — Randomized Complete Block (RCB), Completely Randomized
  (CRD), and resolvable Incomplete Block (Alpha) designs, generated in R with
  `agricolae::design.rcbd` / `design.crd` / `design.alpha`. Alpha designs split each replicate
  into incomplete blocks of a chosen size k; the protocol editor validates the design live and
  blocks a non-conformant alpha layout before a trial is created and distributed.
- **Trial map** — visual plot grid with "hot edit" (click two plots to swap treatments).
- **Measurement setup & data entry** — define measurement columns (measurement type, timing anchored to an
  application + days-after, subsamples) on the Measurements tab, then record measurements on a
  dedicated Data Entry tab: a spreadsheet-style grid (rows = plots, columns = measurements) with
  paste-from-clipboard support. Each measurement also captures event metadata at data-entry time — the
  date performed, who performed it, and the crop growth stage observed — kept separate from the
  protocol definition and surfaced on the report alongside that measurement's results.
- **Calculated measurements** — a measurement column can carry a formula instead of hand-entered
  values; its per-plot value is derived from other measurements referenced by column number
  (`([1]+[2])/2`), with functions (`min/max/abs/round/sqrt`) and `control([n])` / `abbott([n])` for
  **% of untreated control** (mark a treatment as the untreated check). Derived values are read-only
  in the grid and feed ANOVA, the report, and the printed documents like any measurement.
- **Site details & application conditions** — a generic key/value property editor records ad-hoc
  metadata (soil type, previous crop, weather at spraying, …) against the trial site or a specific
  application, with keys accreting into the coded-field library rather than a fixed wall of columns.
- **Statistics** — one-/two-way ANOVA plus mean-comparison tests (Fisher's LSD, Tukey's HSD,
  Duncan's MRT, Student-Newman-Keuls) at α = 0.01 / 0.05 / 0.10, with mean-separation letters,
  CV, grand mean, and critical values. Alpha designs use a block-adjusted analysis
  (`agricolae::PBIB.test`, REML with a variance-components fallback) reporting adjusted treatment
  means and separation letters.
- **Coded-field library** — crop, target, measurement type, unit, part measured, growth stage, timing and
  treatment type are free-type comboboxes backed by a personal library that accretes from use.
  Suggestions are ranked by the current crop (a crop-specific measurement like *awn length* surfaces on
  cereals; general ones like *yield* rank broadly). Each protocol carries a snapshot of the terms it
  uses to trial sites, and a Library tab lets you edit, rename, and import/export the vocabulary.
- **Report** — protocol summary, treatment-means table, and a bar chart with error bars
  (Vega-Lite); export means to CSV or print/save the report as PDF.
- **Printable documents** — a top-level **Print** menu produces field-ready printouts from the
  trial: a large **field map** (colour-by treatment/rep/block), **plot labels/signs** (N-up, two
  sizes), **data-collection sheets** (plots in field order × measurement columns, blank or
  pre-filled, with a metadata header), a **spray record** (per application: treatments & rates,
  actual date, target/actual growth stage, condition properties), a one-page **trial summary**
  (metadata, site details, treatments & rates, application schedule, measurement plan, embedded field
  map), and the **report**. Each renders clean via print CSS and exports to PDF.

## Prerequisites

- **Node.js** ≥ 20
- **R** with the `agricolae` and `jsonlite` packages, for the statistics/randomization engine:

  ```r
  install.packages(c("agricolae", "jsonlite"))
  ```

  `Rscript` must be on your `PATH`, or set a custom path in the app's setup banner (or the
  `ART_RSCRIPT` environment variable). Once base R is present, the app's setup banner offers a
  one-click **"Install required R packages"** button that installs `agricolae` + `jsonlite` for you
  — no need to open R yourself. The app runs without R, but trial generation and analysis are
  disabled until it's available.

## Development

```bash
npm install          # installs deps; rebuilds better-sqlite3 for Electron
npm run dev          # launch the app with hot reload
npm run typecheck    # type-check main + renderer
npm run lint         # ESLint (fails on warnings); npm run format for Prettier
npm run build        # production build into out/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow, and
[docs/DESIGN-PRINCIPLES.md](docs/DESIGN-PRINCIPLES.md) for the design philosophy — in
particular the rule that a field only gets a dedicated box if the software itself consumes it.

### Testing

Unit tests cover the SQLite DAO, the personal library, the R scripts (randomization + ANOVA), and
the shared design/validation logic. Because `better-sqlite3` is a native module, its build target
(ABI) differs between Node and Electron. The `postinstall`/`npm run dev` path builds it for
**Electron**; the test runner needs the **Node** build:

```bash
npm run rebuild:node     # build better-sqlite3 for Node (before testing)
npm test                 # run vitest
npm run rebuild:electron # restore the Electron build (before npm run dev)
```

## Download & install

Grab the build for your platform from the
[Releases](https://github.com/charles-gentry/ART/releases) page.

**Linux** — a self-contained **AppImage**, no installer, no admin rights:

```bash
chmod +x ART-*.AppImage   # make it executable
./ART-*.AppImage          # run it
```

**Windows** — an **NSIS installer** (`ART Setup *.exe`); run it and the app installs per-user (no
admin rights). The installer is currently **unsigned**, so Windows SmartScreen may warn on first
run — choose *More info → Run anyway*.

**macOS** (Apple Silicon) — a **DMG** (`ART-*-arm64.dmg`); open it and drag ART to Applications. The
app is currently **unsigned and un-notarized**, so Gatekeeper blocks it on first launch. Strip the
download quarantine once from a terminal:

```bash
xattr -dr com.apple.quarantine /Applications/ART.app   # then open normally
```

The Linux and Windows builds **auto-update**: on launch the app checks Releases for a newer version,
downloads it in the background, and prompts you to restart when it's ready. The **macOS** build does
*not* auto-update — `electron-updater` requires a signed app to apply macOS updates — so grab new
DMGs from the Releases page manually.

The only external requirement is **R** (for the statistics engine), on every platform. Install base
R once from [r-project.org](https://www.r-project.org/), then let the app's setup banner install the
`agricolae` + `jsonlite` packages for you (see [Prerequisites](#prerequisites)).

### Building & releasing

```bash
npm run package   # unpacked app in dist-app/ (for local testing)
npm run dist      # build a distributable for the host platform locally, no publish
```

`npm run dist` builds the target for whatever OS you run it on (an AppImage on Linux, an NSIS
`.exe` installer on Windows, an arm64 DMG on macOS). Because `better-sqlite3` is a native module,
each platform's distributable must be built on that platform — cross-building is not supported.

The `.R` scripts are shipped as `extraResources`; R itself is a prerequisite and is not bundled.
The app icon lives at `build/icon.png` (electron-builder derives the Windows `.ico` and macOS
`.icns` from it) — replace it with a real logo before a public release.

To cut a release: bump `version` in `package.json`, then tag and push:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

The `Release` GitHub Actions workflow builds on `ubuntu-latest`, `windows-latest`, and
`macos-latest` and publishes each platform's distributable — the Linux AppImage (with
`latest-linux.yml`), the Windows NSIS installer (with `latest.yml`), and the macOS arm64 DMG (with
`latest-mac.yml`) — to the GitHub Release for that tag. The Linux and Windows auto-updaters pick up
new builds automatically; macOS updates are manual (unsigned app).

## Architecture

```
src/
  main/      Electron main process
    db/      better-sqlite3 connection, schema.sql, typed DAO
    r/       R sidecar: detect.ts, run.ts (JSON stdin/stdout), randomize.R, aov.R, service.ts
    ipc/     typed IPC handlers
  preload/   contextBridge API exposed as window.art (contextIsolation on)
  renderer/  React UI (features: protocol, trialmap, measurements, stats, report)
  shared/    domain types + zod schemas + IPC channel names (single source of truth)
```

- The **renderer** has no Node access; every privileged action goes through a typed `window.art.*`
  IPC call to the main process.
- A **project** is a single `.artdb` SQLite file holding the protocol, trial, plots, measurement
  data, and cached analysis results.
- The **R sidecar** is a plain JSON-in / JSON-out child process: the main process writes a request
  on stdin and reads `{ ok, result | error }` on stdout, so the R scripts stay pure and testable.

## Data model

One SQLite file = one project: `protocol` (singleton) · `treatment` · `application` · `trial` ·
`plot` · `measurement_header` · `measurement_value` (long form) · `analysis_result` (cached R output) ·
`library_term` (the coded-vocabulary snapshot that travels with the protocol). The author's
accumulating personal library lives outside the project, in the app's user-data directory. See
`src/main/db/schema.sql`.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full ARM-vs-ART gap analysis and prioritized plan. The v1.0 MVP
focuses on two themes — richer **metadata capture** (applications, measurements, site details) and
**printing** the labels and documents needed in the field — with product-rate calculations, data
transformations, multi-trial summaries, and a tablet collector in later tiers. Feature choices are
governed by the consumer test in [docs/DESIGN-PRINCIPLES.md](docs/DESIGN-PRINCIPLES.md).

## License

MIT
