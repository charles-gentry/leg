import { useState } from 'react'
import { useStore } from '../../store'
import { Combobox } from '../../components/Combobox'
import { TimingField } from '../../components/TimingField'
import { timingLabel } from '@shared/timing'
import { parseFormula } from '@shared/formula'
import type { MeasurementHeader } from '@shared/types'

export function MeasurementsView(): JSX.Element {
  const snapshot = useStore((s) => s.snapshot)
  const setView = useStore((s) => s.setView)
  const trial = snapshot!.trial!
  const headers = snapshot!.measurementHeaders
  return (
    <>
      <HeaderManager trialId={trial.id!} headers={headers} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="primary" onClick={() => setView('dataentry')}>
          Enter data →
        </button>
      </div>
    </>
  )
}

function HeaderManager({
  trialId,
  headers
}: {
  trialId: number
  headers: MeasurementHeader[]
}): JSX.Element {
  const { snapshot, setSnapshot, run } = useStore()
  const applications = snapshot!.applications
  const [draft, setDraft] = useState({
    partMeasured: '',
    measurementType: '',
    measurementUnit: '',
    applicationRef: '',
    daysAfter: null as number | null,
    timing: '',
    analyze: true,
    subsamples: 1,
    formula: ''
  })
  const calc = draft.formula.trim().length > 0
  const parsed = calc ? parseFormula(draft.formula) : null
  const formulaError = parsed && !parsed.ok ? parsed.error : null

  const add = (): void => {
    run('Adding measurement', async () => {
      const label = timingLabel(draft)
      const next = await window.art.measurements.addSiteHeader({
        trialId,
        partMeasured: draft.partMeasured,
        measurementType: draft.measurementType,
        measurementUnit: draft.measurementUnit,
        applicationRef: draft.applicationRef,
        daysAfter: draft.daysAfter,
        timing: draft.timing,
        description:
          [draft.measurementType, draft.partMeasured, label].filter(Boolean).join(' ') || 'Measurement',
        ordinal: headers.length,
        origin: 'site',
        locked: false,
        analyze: draft.analyze,
        subsamples: calc ? 1 : Math.max(1, draft.subsamples || 1),
        formula: calc ? draft.formula.trim() : '',
        // Event metadata (date / assessor / growth stage) is recorded later at data entry.
        measurementDate: '',
        assessedBy: '',
        growthStage: ''
      })
      // Refetch so the new coded terms surface in library suggestions/labels.
      const s = await window.art.project.snapshot()
      setSnapshot(s ?? { ...snapshot!, measurementHeaders: next })
      setDraft({ partMeasured: '', measurementType: '', measurementUnit: '', applicationRef: '', daysAfter: null, timing: '', analyze: true, subsamples: 1, formula: '' })
    })
  }

  const setSubsamples = (h: MeasurementHeader, n: number): void => {
    run('Updating measurement', async () => {
      const next = await window.art.measurements.upsertHeader({ ...h, subsamples: Math.max(1, n || 1) })
      setSnapshot({ ...snapshot!, measurementHeaders: next })
    })
  }

  const remove = (id: number): void => {
    run('Removing measurement', async () => {
      const next = await window.art.measurements.deleteHeader(id)
      setSnapshot({ ...snapshot!, measurementHeaders: next })
    })
  }

  const toggleAnalyze = (h: MeasurementHeader): void => {
    run('Updating measurement', async () => {
      const next = await window.art.measurements.upsertHeader({ ...h, analyze: !h.analyze })
      setSnapshot({ ...snapshot!, measurementHeaders: next })
    })
  }

  return (
    <div className="card">
      <h2>Measurement Columns</h2>
      <p className="muted">
        Core columns are defined by the protocol (locked). You may add site-specific columns below.
      </p>
      {headers.length > 0 && (
        <table className="data" style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 70 }}>Source</th>
              <th>Measurement type</th>
              <th>Part measured</th>
              <th>Unit</th>
              <th>Timing</th>
              <th style={{ width: 70 }}>Subs</th>
              <th style={{ width: 70 }}>Analyze</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {headers.map((h) => (
              <tr key={h.id}>
                <td>
                  {h.origin === 'core' ? (
                    <span className="tag core">🔒 core</span>
                  ) : (
                    <span className="tag site">site</span>
                  )}
                </td>
                <td>
                  {h.measurementType || '—'}
                  {h.formula && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      ƒ {h.formula}
                    </div>
                  )}
                </td>
                <td>{h.partMeasured || '—'}</td>
                <td>{h.measurementUnit || '—'}</td>
                <td>{timingLabel(h) || '—'}</td>
                <td className="num">
                  {h.formula ? (
                    '—'
                  ) : h.origin === 'core' ? (
                    h.subsamples ?? 1
                  ) : (
                    <input
                      type="number"
                      min={1}
                      max={50}
                      style={{ width: 52 }}
                      value={h.subsamples ?? 1}
                      onChange={(e) => setSubsamples(h, Number(e.target.value))}
                      title="Measurements recorded per plot (averaged for analysis)"
                    />
                  )}
                </td>
                <td className="num">
                  <input
                    type="checkbox"
                    checked={h.analyze}
                    disabled={h.origin === 'core'}
                    onChange={() => toggleAnalyze(h)}
                    title={
                      h.origin === 'core'
                        ? 'Set by the protocol'
                        : 'Include this measurement in ANOVA and the report'
                    }
                  />
                </td>
                <td>
                  {h.origin === 'core' || h.locked ? null : (
                    <button className="danger" onClick={() => remove(h.id!)} title="Remove column">
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <div style={{ width: 160 }}>
          <label>Measurement type</label>
          <Combobox
            category="measurement_type"
            crop={snapshot!.protocol.crop}
            value={draft.measurementType}
            onChange={(v) => setDraft({ ...draft, measurementType: v })}
          />
        </div>
        <div style={{ width: 160 }}>
          <label>Part measured</label>
          <Combobox
            category="part_measured"
            crop={snapshot!.protocol.crop}
            value={draft.partMeasured}
            onChange={(v) => setDraft({ ...draft, partMeasured: v })}
          />
        </div>
        <div style={{ width: 110 }}>
          <label>Unit</label>
          <Combobox
            category="unit"
            crop={snapshot!.protocol.crop}
            value={draft.measurementUnit}
            onChange={(v) => setDraft({ ...draft, measurementUnit: v })}
          />
        </div>
        <TimingField
          applications={applications}
          value={draft}
          onChange={(v) => setDraft({ ...draft, ...v })}
        />
        <div style={{ width: 90 }}>
          <label>Subsamples</label>
          <input
            type="number"
            min={1}
            max={50}
            value={draft.subsamples}
            disabled={calc}
            title={calc ? 'Calculated columns have no subsamples' : undefined}
            onChange={(e) => setDraft({ ...draft, subsamples: Number(e.target.value) })}
          />
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label>Formula (optional → calculated)</label>
          <input
            value={draft.formula}
            placeholder="e.g. abbott([1])  or  ([1]+[2])/2"
            onChange={(e) => setDraft({ ...draft, formula: e.target.value })}
          />
        </div>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={draft.analyze}
            onChange={(e) => setDraft({ ...draft, analyze: e.target.checked })}
          />
          Analyze
        </label>
        <button className="primary" onClick={add} disabled={!!formulaError}>
          + Add column
        </button>
      </div>
      {calc && (
        <div style={{ marginTop: 6, fontSize: 12 }}>
          {formulaError ? (
            <span style={{ color: '#b00020' }}>⚠ {formulaError}</span>
          ) : (
            <span className="muted">
              Reference measurements by column number —{' '}
              {headers.map((h, i) => `[${i + 1}] ${h.description || h.measurementType || 'Measurement'}`).join('   ')}
              . Use control([n]) or abbott([n]) for % of untreated control.
            </span>
          )}
        </div>
      )}
    </div>
  )
}
