import { useMemo, useState, type CSSProperties } from 'react'
import { useStore, type DocKind } from '../../store'
import { PlotGrid, type ColourBy } from './PlotGrid'
import { timingLabel, assessmentDate } from '@shared/timing'
import type { AssessmentHeader, Property } from '@shared/types'

const DOC_TITLE: Record<DocKind, string> = {
  fieldmap: 'Field Map',
  labels: 'Plot Labels',
  datasheet: 'Data Collection Sheets',
  spray: 'Spray Record',
  summary: 'Trial Summary'
}

/**
 * Common self-adhesive label stock. Each preset lays the labels out at their true physical size
 * (mm) in the stock's column count, and drives a print-only `@page` size + margin so a straight
 * print at 100% lands on the sheet. `font` tiers the label text to the label height.
 */
export interface LabelStock {
  id: string
  name: string
  page: 'letter' | 'a4'
  cols: number
  /** Label width/height in mm. */
  w: number
  h: number
  /** Column/row gaps in mm. */
  gapX: number
  gapY: number
  /** Top/left page margin in mm (where the first label starts). */
  marginTop: number
  marginLeft: number
  /** Base font size (px) for the label body, sized to the label height. */
  font: number
}

const LABEL_STOCKS: LabelStock[] = [
  { id: 'avery5163', name: 'Avery 5163 — 4×2″, 10/sheet (Letter)', page: 'letter', cols: 2, w: 101.6, h: 50.8, gapX: 4.9, gapY: 0, marginTop: 12.7, marginLeft: 4.2, font: 12 },
  { id: 'avery5164', name: 'Avery 5164 — 4×3⅓″, 6/sheet (Letter)', page: 'letter', cols: 2, w: 101.6, h: 84.7, gapX: 4.9, gapY: 0, marginTop: 12.7, marginLeft: 4.2, font: 13 },
  { id: 'avery5160', name: 'Avery 5160 — 2⅝×1″, 30/sheet (Letter)', page: 'letter', cols: 3, w: 66.7, h: 25.4, gapX: 3.0, gapY: 0, marginTop: 12.7, marginLeft: 4.8, font: 8 },
  { id: 'averyL7165', name: 'Avery L7165 — 99.1×67.7 mm, 8/sheet (A4)', page: 'a4', cols: 2, w: 99.1, h: 67.7, gapX: 2.5, gapY: 0, marginTop: 13.0, marginLeft: 4.65, font: 13 },
  { id: 'averyL7159', name: 'Avery L7159 — 63.5×33.9 mm, 24/sheet (A4)', page: 'a4', cols: 3, w: 63.5, h: 33.9, gapX: 2.5, gapY: 0, marginTop: 13.5, marginLeft: 7.2, font: 9 }
]

/**
 * Renders a single printable document, chosen from the top-level Print menu (not the workflow
 * sidebar — printing is a utility, not a step). The page shows one document with just its
 * print/export actions; there is no on-page document switcher.
 */
export function DocumentsView(): JSX.Element {
  const { snapshot, docKind, run } = useStore()
  const [colourBy, setColourBy] = useState<ColourBy>('treatment')
  const [stockId, setStockId] = useState<string>(LABEL_STOCKS[0].id)
  const [prefilled, setPrefilled] = useState(false)
  // Assessment columns hidden from the data sheet (by header id) — lets a wide sheet fit the page.
  const [hidden, setHidden] = useState<Set<number>>(new Set())

  const protocol = snapshot!.protocol
  const trial = snapshot!.trial
  const isAlpha = protocol.design === 'ALPHA'
  const stock = LABEL_STOCKS.find((s) => s.id === stockId) ?? LABEL_STOCKS[0]
  const allHeaders = [...snapshot!.assessmentHeaders].sort((a, b) => a.ordinal - b.ordinal)
  const toggleHidden = (id: number): void =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const exportPdf = (): void => {
    run('Exporting PDF', async () => {
      await window.art.report.exportPdf({
        title: `${protocol.title || 'Trial'} — ${DOC_TITLE[docKind]}`
      })
    })
  }

  if (!trial) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{DOC_TITLE[docKind]}</h2>
        <p className="muted">Create a trial to generate printable field documents.</p>
      </div>
    )
  }

  return (
    <>
      <div className="card no-print">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="row" style={{ gap: 16, alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>{DOC_TITLE[docKind]}</h2>
            {docKind === 'fieldmap' && (
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                <label style={{ margin: 0 }}>Colour by</label>
                <select value={colourBy} onChange={(e) => setColourBy(e.target.value as ColourBy)}>
                  <option value="none">None</option>
                  <option value="treatment">Treatment</option>
                  <option value="rep">Rep</option>
                  {isAlpha && <option value="block">Block</option>}
                </select>
              </div>
            )}
            {docKind === 'labels' && (
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                <label style={{ margin: 0 }}>Label stock</label>
                <select value={stockId} onChange={(e) => setStockId(e.target.value)}>
                  {LABEL_STOCKS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {docKind === 'datasheet' && (
              <label className="checkbox-inline" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={prefilled}
                  onChange={(e) => setPrefilled(e.target.checked)}
                />
                Pre-fill recorded values
              </label>
            )}
          </div>
          <div className="row">
            <button className="primary" onClick={exportPdf}>
              Export PDF
            </button>
            <button onClick={() => window.print()}>Print</button>
          </div>
        </div>

        {docKind === 'datasheet' && allHeaders.length > 0 && (
          <div className="row" style={{ marginTop: 10, gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className="muted" style={{ fontSize: 13 }}>Columns:</span>
            {allHeaders.map((h) => (
              <label key={h.id} className="checkbox-inline" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={!hidden.has(h.id!)}
                  onChange={() => toggleHidden(h.id!)}
                />
                {headerTitleOf(h)}
              </label>
            ))}
          </div>
        )}
      </div>

      {docKind === 'fieldmap' && <FieldMapDoc colourBy={colourBy} />}
      {docKind === 'labels' && <PlotLabelsDoc stock={stock} />}
      {docKind === 'datasheet' && <DataSheetDoc prefilled={prefilled} hidden={hidden} />}
      {docKind === 'spray' && <SprayRecordDoc />}
      {docKind === 'summary' && <SummaryDoc />}
    </>
  )
}

/** Common title block atop each printed document. */
function DocHeader({ subtitle }: { subtitle: string }): JSX.Element {
  const { snapshot } = useStore()
  const protocol = snapshot!.protocol
  const trial = snapshot!.trial!
  const site = [trial.siteName, trial.location, trial.city, trial.state, trial.country]
    .filter(Boolean)
    .join(', ')
  return (
    <div className="doc-title">
      <h1>{protocol.title || 'Untitled trial'}</h1>
      <p className="report-subtitle">
        {subtitle}
        {site ? ` · ${site}` : ''}
      </p>
    </div>
  )
}

/** B1 — the physical plot layout, printed large for use in the field. */
function FieldMapDoc({ colourBy }: { colourBy: ColourBy }): JSX.Element {
  const { snapshot } = useStore()
  const protocol = snapshot!.protocol
  return (
    <div className="doc-page">
      <DocHeader
        subtitle={`Field map — ${protocol.design}, ${protocol.replicates} reps, ${snapshot!.plots.length} plots`}
      />
      <PlotGrid snapshot={snapshot!} colourBy={colourBy} cell={56} />
      <p className="muted doc-foot">
        Rows are numbered from the bottom-left corner. Each cell shows the plot number, treatment
        (T#), and rep (R#){protocol.design === 'ALPHA' ? ' and block (B#)' : ''}.
      </p>
    </div>
  )
}

/** B4 — one-page overview: metadata, site details, treatments, schedule, assessments, field map. */
function SummaryDoc(): JSX.Element {
  const { snapshot } = useStore()
  const protocol = snapshot!.protocol
  const trial = snapshot!.trial!
  const actuals = snapshot!.applicationActuals

  const siteProps = snapshot!.properties.filter((p) => p.scope === 'trial')
  const condsByCode = useMemo(() => {
    const m = new Map<string, Property[]>()
    for (const p of snapshot!.properties.filter((x) => x.scope === 'application')) {
      const list = m.get(p.scopeRef) ?? []
      list.push(p)
      m.set(p.scopeRef, list)
    }
    return m
  }, [snapshot])

  const applications = [...snapshot!.applications].sort((a, b) => a.ordinal - b.ordinal)
  const actualDate = (code: string): string =>
    actuals.find((x) => x.timingCode === code)?.actualDate || ''

  const headerTitle = (h: AssessmentHeader): string =>
    h.description || h.ratingType || `Assessment ${h.ordinal + 1}`
  const headers = [...snapshot!.assessmentHeaders].sort((a, b) => a.ordinal - b.ordinal)

  return (
    <div className="doc-page">
      <DocHeader subtitle="Trial summary" />

      {/* Metadata + site details */}
      <table className="report-meta" style={{ maxWidth: 720 }}>
        <tbody>
          <tr>
            <th>Crop</th>
            <td>{protocol.crop || '—'}</td>
            <th>Season</th>
            <td>{protocol.season || '—'}</td>
          </tr>
          <tr>
            <th>Target</th>
            <td>{protocol.targetPest || '—'}</td>
            <th>Design</th>
            <td>
              {protocol.design}, {protocol.replicates} reps, {snapshot!.plots.length} plots
            </td>
          </tr>
          <tr>
            <th>Investigator</th>
            <td>{protocol.investigator || '—'}</td>
            <th>Operator</th>
            <td>{trial.operator || '—'}</td>
          </tr>
          <tr>
            <th>Planting date</th>
            <td>{trial.plantingDate || '—'}</td>
            <th>Protocol</th>
            <td>
              <code>{protocol.protocolUid.slice(0, 8) || '—'}</code> v{protocol.protocolVersion}
            </td>
          </tr>
          {siteProps.map((p) => (
            <tr key={p.id}>
              <th>{p.key}</th>
              <td colSpan={3}>{p.value || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Treatments */}
      <h2>Treatments</h2>
      <table className="data">
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>Name</th>
            <th style={{ width: 70 }}>Timing</th>
            <th>Product</th>
            <th>Rate</th>
          </tr>
        </thead>
        <tbody>
          {snapshot!.treatments.map((t) =>
            t.applications.length === 0 ? (
              <tr key={t.number}>
                <td className="num">{t.number}</td>
                <td>{t.name || `Treatment ${t.number}`}</td>
                <td>—</td>
                <td className="muted">untreated</td>
                <td>—</td>
              </tr>
            ) : (
              t.applications.map((l, li) => (
                <tr key={`${t.number}-${li}`}>
                  {li === 0 ? (
                    <>
                      <td className="num" rowSpan={t.applications.length}>
                        {t.number}
                      </td>
                      <td rowSpan={t.applications.length}>{t.name || `Treatment ${t.number}`}</td>
                    </>
                  ) : null}
                  <td>{l.applicationRef || '—'}</td>
                  <td>{l.product || '—'}</td>
                  <td>{[l.rate, l.rateUnit].filter(Boolean).join(' ') || '—'}</td>
                </tr>
              ))
            )
          )}
        </tbody>
      </table>

      {/* Application schedule */}
      {applications.length > 0 && (
        <>
          <h2>Application schedule</h2>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Timing</th>
                <th>Target growth stage</th>
                <th style={{ width: 110 }}>Actual date</th>
                <th>Conditions</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => {
                const conds = condsByCode.get(a.timingCode) ?? []
                return (
                  <tr key={a.timingCode}>
                    <td>{a.timingCode || '—'}</td>
                    <td>{a.targetGrowthStage || a.description || '—'}</td>
                    <td>{actualDate(a.timingCode) || '—'}</td>
                    <td>
                      {conds.length
                        ? conds.map((c) => `${c.key}: ${c.value}`).join(' · ')
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}

      {/* Assessment plan */}
      {headers.length > 0 && (
        <>
          <h2>Assessment plan</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Assessment</th>
                <th style={{ width: 80 }}>Timing</th>
                <th style={{ width: 110 }}>Est. date</th>
                <th style={{ width: 120 }}>Growth stage</th>
              </tr>
            </thead>
            <tbody>
              {headers.map((h) => (
                <tr key={h.id}>
                  <td>{headerTitle(h)}</td>
                  <td>{timingLabel(h) || '—'}</td>
                  <td>{assessmentDate(h, actuals) || '—'}</td>
                  <td>{h.growthStage || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Embedded field map */}
      <h2 className="doc-break">Field map</h2>
      <PlotGrid snapshot={snapshot!} colourBy="treatment" cell={44} />
    </div>
  )
}

const headerTitleOf = (h: AssessmentHeader): string =>
  h.description || h.ratingType || `Assessment ${h.ordinal + 1}`
const subCountOf = (h: AssessmentHeader): number => Math.max(1, h.subsamples ?? 1)

/** B3 — plots in field order × assessment columns, with blank cells for recording (or pre-filled).
 *  `hidden` drops selected assessment columns so a wide sheet fits the page. */
function DataSheetDoc({ prefilled, hidden }: { prefilled: boolean; hidden: Set<number> }): JSX.Element {
  const { snapshot } = useStore()
  const protocol = snapshot!.protocol
  const trial = snapshot!.trial!

  const treatment = useMemo(
    () => new Map(snapshot!.treatments.map((t) => [t.id!, t])),
    [snapshot]
  )
  const trtName = (id: number): string => {
    const t = treatment.get(id)
    return t ? `${t.number}. ${t.name || 'Trt ' + t.number}` : `#${id}`
  }
  const headers = [...snapshot!.assessmentHeaders]
    .sort((a, b) => a.ordinal - b.ordinal)
    .filter((h) => !hidden.has(h.id!))
  const plots = [...snapshot!.plots].sort((a, b) => a.plotNumber - b.plotNumber)

  const valueMap = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const v of snapshot!.assessmentValues)
      m.set(`${v.assessmentHeaderId}:${v.plotId}:${v.subsample ?? 1}`, v.value)
    return m
  }, [snapshot])
  const meanFor = (h: AssessmentHeader, plotId: number): string => {
    const vals: number[] = []
    for (let s = 1; s <= subCountOf(h); s++) {
      const v = valueMap.get(`${h.id}:${plotId}:${s}`)
      if (v !== null && v !== undefined) vals.push(v)
    }
    if (!vals.length) return ''
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    return String(Math.round(mean * 100) / 100)
  }

  const siteProps = snapshot!.properties.filter((p) => p.scope === 'trial')

  return (
    <div className="doc-page">
      <DocHeader subtitle="Data collection sheet" />
      <table className="report-meta" style={{ maxWidth: 720, marginBottom: 8 }}>
        <tbody>
          <tr>
            <th>Crop</th>
            <td>{protocol.crop || '—'}</td>
            <th>Planting date</th>
            <td>{trial.plantingDate || '—'}</td>
          </tr>
          <tr>
            <th>Assessed by</th>
            <td className="fill-line" />
            <th>Date</th>
            <td className="fill-line" />
          </tr>
          <tr>
            <th>Growth stage</th>
            <td className="fill-line" />
            <th>Notes</th>
            <td className="fill-line" />
          </tr>
          {siteProps.map((p) => (
            <tr key={p.id}>
              <th>{p.key}</th>
              <td colSpan={3}>{p.value || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ overflowX: 'auto' }}>
        <table className="data datasheet">
          <thead>
            <tr>
              <th style={{ width: 46 }}>Plot</th>
              <th style={{ width: 40 }}>Rep</th>
              <th>Treatment</th>
              {headers.map((h) => (
                <th key={h.id}>
                  {headerTitleOf(h)}
                  {subCountOf(h) > 1 ? ` (×${subCountOf(h)})` : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plots.map((p) => (
              <tr key={p.id} className={p.excluded ? 'dsg-row-excluded' : undefined}>
                <td className="num">{p.plotNumber}</td>
                <td className="num">{p.rep}</td>
                <td>{trtName(p.treatmentId)}</td>
                {headers.map((h) => (
                  <td key={h.id} className="entry-cell">
                    {prefilled ? meanFor(h, p.id!) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted doc-foot">
        Plots are listed in ascending plot-number order.
        {snapshot!.plots.some((p) => p.excluded) ? ' Shaded rows are excluded from analysis.' : ''}
      </p>
    </div>
  )
}

/** B2 — plot labels/signs laid out to a chosen self-adhesive label stock (plot #, rep, treatment,
 *  trial). Labels render at their true physical size; a print-only @page matches the sheet so a
 *  straight print at 100% aligns to the stock. */
function PlotLabelsDoc({ stock }: { stock: LabelStock }): JSX.Element {
  const { snapshot } = useStore()
  const protocol = snapshot!.protocol
  const isAlpha = protocol.design === 'ALPHA'
  const treatment = useMemo(
    () => new Map(snapshot!.treatments.map((t) => [t.id!, t])),
    [snapshot]
  )
  const plots = [...snapshot!.plots].sort((a, b) => a.plotNumber - b.plotNumber)

  // Physical layout from the stock preset; the label body font scales to the label height.
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${stock.cols}, ${stock.w}mm)`,
    columnGap: `${stock.gapX}mm`,
    rowGap: `${stock.gapY}mm`
  }
  const labelStyle: CSSProperties = {
    width: `${stock.w}mm`,
    height: `${stock.h}mm`,
    fontSize: `${stock.font}px`
  }

  return (
    <div className="doc-page labels-page">
      {/* Print-only page geometry so the labels land on the physical sheet. */}
      <style>{`@media print {
        @page { size: ${stock.page === 'a4' ? 'A4' : 'letter'}; margin: ${stock.marginTop}mm ${stock.marginLeft}mm; }
      }`}</style>
      <div className="label-grid" style={gridStyle}>
        {plots.map((p) => {
          const t = treatment.get(p.treatmentId)
          return (
            <div className="plot-label" key={p.id} style={labelStyle}>
              <div className="pl-trial">{protocol.title || 'Trial'}</div>
              <div className="pl-plot">Plot {p.plotNumber}</div>
              <div className="pl-meta">
                Rep {p.rep}
                {isAlpha ? ` · Block ${p.block}` : ''}
              </div>
              <div className="pl-trt">
                {t ? `${t.number}. ${t.name || 'Treatment ' + t.number}` : `#${p.treatmentId}`}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** B5 — per-application spray record: treatments & rates applied at each timing, with conditions. */
function SprayRecordDoc(): JSX.Element {
  const { snapshot } = useStore()
  const actuals = snapshot!.applicationActuals
  const applications = [...snapshot!.applications].sort((a, b) => a.ordinal - b.ordinal)
  const actualDate = (code: string): string =>
    actuals.find((x) => x.timingCode === code)?.actualDate || ''
  const condsFor = (code: string): Property[] =>
    snapshot!.properties.filter((p) => p.scope === 'application' && p.scopeRef === code)

  // Treatment program lines that spray at a given timing code.
  const linesAt = (code: string): { number: number; name: string; product: string; rate: string }[] => {
    const out: { number: number; name: string; product: string; rate: string }[] = []
    for (const t of snapshot!.treatments)
      for (const l of t.applications)
        if (l.applicationRef === code)
          out.push({
            number: t.number,
            name: t.name || `Treatment ${t.number}`,
            product: l.product || '—',
            rate: [l.rate, l.rateUnit].filter(Boolean).join(' ') || '—'
          })
    return out.sort((a, b) => a.number - b.number)
  }

  return (
    <div className="doc-page">
      <DocHeader subtitle="Spray / application record" />
      {applications.length === 0 && (
        <p className="muted">No applications are defined in the protocol.</p>
      )}
      {applications.map((a) => {
        const lines = linesAt(a.timingCode)
        const conds = condsFor(a.timingCode)
        return (
          <div className="spray-block" key={a.timingCode}>
            <h2>Application {a.timingCode || '—'}</h2>
            <table className="report-meta" style={{ maxWidth: 720, marginBottom: 6 }}>
              <tbody>
                <tr>
                  <th>Target growth stage</th>
                  <td>{a.targetGrowthStage || '—'}</td>
                  <th>Actual date</th>
                  <td>{actualDate(a.timingCode) || <span className="fill-line" />}</td>
                </tr>
                <tr>
                  <th>Actual growth stage</th>
                  <td className="fill-line" />
                  <th>Operator</th>
                  <td className="fill-line" />
                </tr>
                {conds.map((c) => (
                  <tr key={c.id}>
                    <th>{c.key}</th>
                    <td colSpan={3}>{c.value || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Treatment</th>
                  <th>Product</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No treatments spray at this timing.
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => (
                    <tr key={i}>
                      <td className="num">{l.number}</td>
                      <td>{l.name}</td>
                      <td>{l.product}</td>
                      <td>{l.rate}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
