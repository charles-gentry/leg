import { useState, useEffect, Fragment } from 'react'
import { useStore } from '../../store'
import { Combobox } from '../../components/Combobox'
import { TimingField } from '../../components/TimingField'
import { ApplicationsEditor } from './ApplicationsEditor'
import { TreatmentProgram, programSummary } from './TreatmentProgram'
import { timingLabel } from '@shared/timing'
import { parseFormula } from '@shared/formula'
import { validateDesign } from '@shared/design'
import type { Protocol, Treatment, MeasurementDef, DesignType, LibraryCategory } from '@shared/types'

export function ProtocolView(): JSX.Element {
  const { snapshot, setSnapshot, setView, run } = useStore()
  const readOnly = snapshot!.role === 'trial'

  const createTrial = (): void =>
    void run('Creating trial', async () => {
      const s = await window.art.trial.newFromCurrent()
      if (s) {
        setSnapshot(s)
        setView(s.trial ? 'trialmap' : 'site')
      }
    })
  const [protocol, setProtocol] = useState<Protocol>(snapshot!.protocol)
  const [treatments, setTreatments] = useState<Treatment[]>(snapshot!.treatments)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const toggleExpanded = (n: number): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })

  // Resync local edit buffers only when a different file loads (not on every snapshot change).
  const filePath = snapshot!.filePath
  useEffect(() => {
    setProtocol(snapshot!.protocol)
    setTreatments(snapshot!.treatments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  // Live conformance check so a non-conformant design is caught here, not downstream.
  const designValidation = validateDesign(
    protocol.design,
    protocol.replicates,
    protocol.blockSize,
    treatments.length
  )

  const saveProtocol = (next: Protocol = protocol): void => {
    if (readOnly) return
    run('Saving protocol', async () => {
      await window.art.protocol.save(next)
      // Refetch so library-term suggestions/labels (updated server-side) stay in sync.
      const s = await window.art.project.snapshot()
      if (s) setSnapshot(s)
    })
  }

  const field = (key: keyof Protocol, label: string, textarea = false): JSX.Element => (
    <div style={textarea ? { gridColumn: '1 / -1' } : undefined}>
      <label>{label}</label>
      {textarea ? (
        <textarea
          rows={3}
          disabled={readOnly}
          value={protocol[key] as string}
          onChange={(e) => setProtocol({ ...protocol, [key]: e.target.value })}
          onBlur={() => saveProtocol()}
        />
      ) : (
        <input
          disabled={readOnly}
          value={protocol[key] as string}
          onChange={(e) => setProtocol({ ...protocol, [key]: e.target.value })}
          onBlur={() => saveProtocol()}
        />
      )}
    </div>
  )

  // A protocol field backed by a library vocabulary (crop-aware suggestions + free type).
  const comboField = (key: keyof Protocol, label: string, category: LibraryCategory): JSX.Element => (
    <div>
      <label>{label}</label>
      <Combobox
        category={category}
        crop={category === 'crop' ? '' : protocol.crop}
        disabled={readOnly}
        value={protocol[key] as string}
        onChange={(v) => {
          const next = { ...protocol, [key]: v }
          setProtocol(next)
          saveProtocol(next)
        }}
      />
    </div>
  )

  const saveTreatments = (next: Treatment[]): void => {
    if (readOnly) return
    setTreatments(next)
    run('Saving treatments', async () => {
      await window.art.treatments.save(next)
      const s = await window.art.project.snapshot()
      if (s) setSnapshot(s)
    })
  }

  const addTreatment = (): void => {
    const number = treatments.length ? Math.max(...treatments.map((t) => t.number)) + 1 : 1
    saveTreatments([
      ...treatments,
      {
        number,
        name: number === 1 ? 'Untreated Check' : '',
        type: '',
        isCheck: number === 1,
        applications: []
      }
    ])
  }

  const updateTreatment = (i: number, patch: Partial<Treatment>): void => {
    setTreatments(treatments.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  }

  return (
    <>
      {readOnly && (
        <div className="banner locked">
          🔒 Protocol locked — this file is a trial instance of protocol{' '}
          <code>{protocol.protocolUid.slice(0, 8) || '—'}</code> v{protocol.protocolVersion}. The
          treatments, design, and core measurements were set by the author and cannot be changed.
        </div>
      )}

      <div className="card">
        <h2>Protocol</h2>
        <div className="field-grid">
          {field('title', 'Trial title')}
          {comboField('crop', 'Crop', 'crop')}
          {comboField('targetPest', 'Target pest / disease', 'target')}
          {field('investigator', 'Investigator')}
          {field('season', 'Season / year')}
          {field('objective', 'Objective')}
          {field('notes', 'Notes', true)}
        </div>
      </div>

      <div className="card">
        <h2>Experimental Design</h2>
        <p className="muted">
          {readOnly
            ? 'Fixed by the protocol. Every site uses this design; only the randomization differs.'
            : 'Dictated to all trial sites. Sites re-randomize with their own seed but keep this design.'}
        </p>
        <div className="row">
          <div style={{ width: 220 }}>
            <label>Design</label>
            <select
              disabled={readOnly}
              value={protocol.design}
              onChange={(e) => {
                const next = { ...protocol, design: e.target.value as DesignType }
                setProtocol(next)
                saveProtocol(next)
              }}
            >
              <option value="RCB">Randomized Complete Block</option>
              <option value="CRD">Completely Randomized</option>
              <option value="ALPHA">Incomplete Block (Alpha)</option>
            </select>
          </div>
          <div style={{ width: 110 }}>
            <label>Replicates</label>
            <input
              type="number"
              min={2}
              max={20}
              disabled={readOnly}
              value={protocol.replicates}
              onChange={(e) => setProtocol({ ...protocol, replicates: Number(e.target.value) })}
              onBlur={() => saveProtocol()}
            />
          </div>
          {protocol.design === 'ALPHA' && (
            <div style={{ width: 110 }}>
              <label>Block size (k)</label>
              <input
                type="number"
                min={3}
                disabled={readOnly}
                value={protocol.blockSize}
                onChange={(e) => setProtocol({ ...protocol, blockSize: Number(e.target.value) })}
                onBlur={() => saveProtocol()}
              />
            </div>
          )}
          <div style={{ width: 110 }}>
            <label>Plot width</label>
            <input
              type="number"
              disabled={readOnly}
              value={protocol.plotWidth}
              onChange={(e) => setProtocol({ ...protocol, plotWidth: Number(e.target.value) })}
              onBlur={() => saveProtocol()}
            />
          </div>
          <div style={{ width: 110 }}>
            <label>Plot length</label>
            <input
              type="number"
              disabled={readOnly}
              value={protocol.plotLength}
              onChange={(e) => setProtocol({ ...protocol, plotLength: Number(e.target.value) })}
              onBlur={() => saveProtocol()}
            />
          </div>
        </div>
        {protocol.design === 'ALPHA' &&
          (designValidation.ok ? (
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Each replicate is split into {Math.floor(treatments.length / protocol.blockSize)}{' '}
              incomplete blocks of {protocol.blockSize} plots.
              {designValidation.validReplicates &&
                ` Supported replicate counts for this layout: ${designValidation.validReplicates.join(', ')}.`}
            </p>
          ) : (
            <p
              style={{
                marginTop: 8,
                marginBottom: 0,
                color: 'var(--danger)',
                fontWeight: 500
              }}
            >
              ⚠ {designValidation.error} A trial cannot be created until this is resolved.
            </p>
          ))}
      </div>

      <ApplicationsEditor readOnly={readOnly} />

      <div className="card">
        <h2>Treatments</h2>
        <p className="muted">
          Each treatment is a program — its sequence of applications (product + rate at each timing).
          Expand a row to edit the program.
        </p>
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th style={{ width: 40 }}>#</th>
              <th style={{ width: 200 }}>Name</th>
              <th>Program</th>
              <th style={{ width: 60 }} title="Untreated check — used by % control formulas">
                Check
              </th>
              {!readOnly && <th style={{ width: 40 }}></th>}
            </tr>
          </thead>
          <tbody>
            {treatments.map((t, i) => (
              <Fragment key={i}>
                <tr>
                  <td>
                    <button
                      className="expander"
                      title={expanded.has(t.number) ? 'Collapse' : 'Expand program'}
                      onClick={() => toggleExpanded(t.number)}
                    >
                      {expanded.has(t.number) ? '▾' : '▸'}
                    </button>
                  </td>
                  <td className="num">{t.number}</td>
                  <td>
                    <input
                      disabled={readOnly}
                      value={t.name}
                      onChange={(e) => updateTreatment(i, { name: e.target.value })}
                      onBlur={() => saveTreatments(treatments)}
                    />
                  </td>
                  <td
                    className="muted"
                    style={{ cursor: 'pointer', fontSize: 12 }}
                    onClick={() => toggleExpanded(t.number)}
                  >
                    {programSummary(t)}
                  </td>
                  <td className="num">
                    <input
                      type="checkbox"
                      disabled={readOnly}
                      checked={!!t.isCheck}
                      title="Mark as the untreated check for % control formulas"
                      onChange={(e) => {
                        const next = treatments.map((x, idx) =>
                          idx === i ? { ...x, isCheck: e.target.checked } : x
                        )
                        setTreatments(next)
                        saveTreatments(next)
                      }}
                    />
                  </td>
                  {!readOnly && (
                    <td>
                      <button
                        className="danger"
                        title="Remove treatment"
                        onClick={() => saveTreatments(treatments.filter((_, idx) => idx !== i))}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
                {expanded.has(t.number) && (
                  <tr>
                    <td />
                    <td colSpan={readOnly ? 4 : 5}>
                      <TreatmentProgram
                        applications={snapshot!.applications}
                        crop={protocol.crop}
                        disabled={readOnly}
                        value={t.applications}
                        onChange={(lines) =>
                          setTreatments(
                            treatments.map((x, idx) => (idx === i ? { ...x, applications: lines } : x))
                          )
                        }
                        onCommit={(lines) =>
                          saveTreatments(
                            treatments.map((x, idx) => (idx === i ? { ...x, applications: lines } : x))
                          )
                        }
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!readOnly && (
          <div style={{ marginTop: 10 }}>
            <button onClick={addTreatment}>+ Add treatment</button>
          </div>
        )}
      </div>

      <CoreMeasurements readOnly={readOnly} />

      {!readOnly && (
        <div className="card cta-row">
          <div>
            <strong>Ready to run this protocol?</strong>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              Create a trial from it to generate a randomized layout and enter data — all in this
              session.
            </p>
          </div>
          <button
            className="primary"
            onClick={createTrial}
            disabled={!designValidation.ok}
            title={designValidation.ok ? undefined : designValidation.error}
          >
            Create Trial from this Protocol →
          </button>
        </div>
      )}
    </>
  )
}

/** Author-defined core measurement schedule. Read-only when viewed inside a trial. */
function CoreMeasurements({ readOnly }: { readOnly: boolean }): JSX.Element {
  const { snapshot, setSnapshot, run } = useStore()
  const defs = snapshot!.measurementDefs
  const applications = snapshot!.applications
  const crop = snapshot!.protocol.crop
  const [draft, setDraft] = useState({
    partMeasured: '',
    measurementType: '',
    measurementUnit: '',
    applicationRef: '',
    daysAfter: null as number | null,
    timing: '',
    subsamples: 1,
    formula: ''
  })
  const calc = draft.formula.trim().length > 0
  const parsed = calc ? parseFormula(draft.formula) : null
  const formulaError = parsed && !parsed.ok ? parsed.error : null

  const save = (next: MeasurementDef[]): void => {
    run('Saving measurements', async () => {
      await window.art.measurements.saveDefs(next)
      const s = await window.art.project.snapshot()
      if (s) setSnapshot(s)
    })
  }

  const add = (): void => {
    const label = timingLabel(draft)
    save([
      ...defs,
      {
        partMeasured: draft.partMeasured,
        measurementType: draft.measurementType,
        measurementUnit: draft.measurementUnit,
        applicationRef: draft.applicationRef,
        daysAfter: draft.daysAfter,
        timing: draft.timing,
        description:
          [draft.measurementType, draft.partMeasured, label].filter(Boolean).join(' ') || 'Measurement',
        ordinal: defs.length,
        analyze: true,
        subsamples: calc ? 1 : Math.max(1, draft.subsamples || 1),
        formula: calc ? draft.formula.trim() : ''
      }
    ])
    setDraft({ partMeasured: '', measurementType: '', measurementUnit: '', applicationRef: '', daysAfter: null, timing: '', subsamples: 1, formula: '' })
  }

  const toggleAnalyze = (i: number): void => {
    save(defs.map((d, idx) => (idx === i ? { ...d, analyze: !d.analyze } : d)))
  }

  return (
    <div className="card">
      <h2>Core Measurements</h2>
      <p className="muted">
        The measurement schedule every site must collect. Sites may add their own extra columns but
        cannot change these.
      </p>
      {defs.length > 0 ? (
        <table className="data" style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th>Measurement type</th>
              <th>Part measured</th>
              <th>Unit</th>
              <th>Timing</th>
              <th style={{ width: 70 }}>Subs</th>
              <th style={{ width: 80 }}>Analyze</th>
              {!readOnly && <th style={{ width: 40 }}></th>}
            </tr>
          </thead>
          <tbody>
            {defs.map((d, i) => (
              <tr key={d.id ?? i}>
                <td>
                  {d.measurementType || '—'}
                  {d.formula && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      ƒ {d.formula}
                    </div>
                  )}
                </td>
                <td>{d.partMeasured || '—'}</td>
                <td>{d.measurementUnit || '—'}</td>
                <td>{timingLabel(d) || '—'}</td>
                <td className="num">{d.formula ? '—' : d.subsamples ?? 1}</td>
                <td className="num">
                  <input
                    type="checkbox"
                    checked={d.analyze}
                    disabled={readOnly}
                    onChange={() => toggleAnalyze(i)}
                    title="Include this measurement in ANOVA and the report"
                  />
                </td>
                {!readOnly && (
                  <td>
                    <button className="danger" onClick={() => save(defs.filter((_, idx) => idx !== i))}>
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No core measurements defined{readOnly ? '.' : ' yet.'}</p>
      )}
      {!readOnly && (
        <>
        <div className="row">
          <div style={{ width: 160 }}>
            <label>Measurement type</label>
            <Combobox
              category="measurement_type"
              crop={crop}
              value={draft.measurementType}
              onChange={(v) => setDraft({ ...draft, measurementType: v })}
            />
          </div>
          <div style={{ width: 160 }}>
            <label>Part measured</label>
            <Combobox
              category="part_measured"
              crop={crop}
              value={draft.partMeasured}
              onChange={(v) => setDraft({ ...draft, partMeasured: v })}
            />
          </div>
          <div style={{ width: 110 }}>
            <label>Unit</label>
            <Combobox
              category="unit"
              crop={crop}
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
          <div style={{ flex: 1, minWidth: 200 }}>
            <label>Formula (optional → calculated column)</label>
            <input
              value={draft.formula}
              placeholder="e.g. abbott([1])  or  ([1]+[2])/2"
              onChange={(e) => setDraft({ ...draft, formula: e.target.value })}
            />
          </div>
          <button className="primary" onClick={add} disabled={!!formulaError}>
            + Add measurement
          </button>
        </div>
        {calc && (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            {formulaError ? (
              <span style={{ color: '#b00020' }}>⚠ {formulaError}</span>
            ) : (
              <span className="muted">
                Reference measurements by column number —{' '}
                {defs.map((d, i) => `[${i + 1}] ${d.description || d.measurementType || 'Measurement'}`).join('   ')}
                {defs.length === 0 && 'no measurements to reference yet'}. Use control([n]) or
                abbott([n]) for % of untreated control.
              </span>
            )}
          </div>
        )}
        </>
      )}
    </div>
  )
}
