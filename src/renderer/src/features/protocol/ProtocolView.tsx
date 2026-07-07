import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import type { Protocol, Treatment, AssessmentDef, DesignType } from '@shared/types'

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

  // Keep local editable copies in sync when a new file loads.
  useEffect(() => {
    setProtocol(snapshot!.protocol)
    setTreatments(snapshot!.treatments)
  }, [snapshot!.filePath])

  const saveProtocol = (next: Protocol = protocol): void => {
    if (readOnly) return
    run('Saving protocol', async () => {
      const saved = await window.art.protocol.save(next)
      setSnapshot({ ...useStore.getState().snapshot!, protocol: saved })
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

  const saveTreatments = (next: Treatment[]): void => {
    if (readOnly) return
    setTreatments(next)
    run('Saving treatments', async () => {
      const saved = await window.art.treatments.save(next)
      setSnapshot({ ...useStore.getState().snapshot!, treatments: saved })
    })
  }

  const addTreatment = (): void => {
    const number = treatments.length ? Math.max(...treatments.map((t) => t.number)) + 1 : 1
    saveTreatments([
      ...treatments,
      { number, name: number === 1 ? 'Untreated Check' : '', product: '', rate: '', rateUnit: '', type: '' }
    ])
  }

  const updateTreatment = (i: number, patch: Partial<Treatment>): void => {
    setTreatments(treatments.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  }

  return (
    <>
      {readOnly ? (
        <div className="banner locked">
          🔒 Protocol locked — this file is a trial instance of protocol{' '}
          <code>{protocol.protocolUid.slice(0, 8) || '—'}</code> v{protocol.protocolVersion}. The
          treatments, design, and core assessments were set by the author and cannot be changed.
        </div>
      ) : (
        <div className="card cta-row">
          <div>
            <strong>Ready to run this protocol?</strong>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              Create a trial from it to generate a randomized layout and enter data — all in this
              session.
            </p>
          </div>
          <button className="primary" onClick={createTrial}>
            Create Trial from this Protocol →
          </button>
        </div>
      )}

      <div className="card">
        <h2>Protocol</h2>
        <div className="field-grid">
          {field('title', 'Trial title')}
          {field('crop', 'Crop')}
          {field('targetPest', 'Target pest / disease')}
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
                min={2}
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
        {protocol.design === 'ALPHA' && (
          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
            The treatment count must be divisible by the block size (k), with at least k blocks per
            replicate (so k must be no larger than √treatments). Each replicate is split into{' '}
            {treatments.length && protocol.blockSize
              ? Math.max(1, Math.floor(treatments.length / protocol.blockSize))
              : 'n'}{' '}
            incomplete blocks of {protocol.blockSize} plots. Some block/replicate combinations have
            no alpha design — 2 replicates work for most.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Treatments</h2>
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>Name</th>
              <th>Product</th>
              <th style={{ width: 90 }}>Rate</th>
              <th style={{ width: 90 }}>Unit</th>
              {!readOnly && <th style={{ width: 40 }}></th>}
            </tr>
          </thead>
          <tbody>
            {treatments.map((t, i) => (
              <tr key={i}>
                <td className="num">{t.number}</td>
                <td>
                  <input
                    disabled={readOnly}
                    value={t.name}
                    onChange={(e) => updateTreatment(i, { name: e.target.value })}
                    onBlur={() => saveTreatments(treatments)}
                  />
                </td>
                <td>
                  <input
                    disabled={readOnly}
                    value={t.product}
                    onChange={(e) => updateTreatment(i, { product: e.target.value })}
                    onBlur={() => saveTreatments(treatments)}
                  />
                </td>
                <td>
                  <input
                    disabled={readOnly}
                    value={t.rate}
                    onChange={(e) => updateTreatment(i, { rate: e.target.value })}
                    onBlur={() => saveTreatments(treatments)}
                  />
                </td>
                <td>
                  <input
                    disabled={readOnly}
                    value={t.rateUnit}
                    onChange={(e) => updateTreatment(i, { rateUnit: e.target.value })}
                    onBlur={() => saveTreatments(treatments)}
                  />
                </td>
                {!readOnly && (
                  <td>
                    <button
                      title="Remove"
                      onClick={() => saveTreatments(treatments.filter((_, idx) => idx !== i))}
                    >
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!readOnly && (
          <div style={{ marginTop: 10 }}>
            <button onClick={addTreatment}>+ Add treatment</button>
          </div>
        )}
      </div>

      <CoreAssessments readOnly={readOnly} />
    </>
  )
}

/** Author-defined core assessment schedule. Read-only when viewed inside a trial. */
function CoreAssessments({ readOnly }: { readOnly: boolean }): JSX.Element {
  const { snapshot, setSnapshot, run } = useStore()
  const defs = snapshot!.assessmentDefs
  const [draft, setDraft] = useState({ partRated: '', ratingType: '', ratingUnit: '', timing: '', subsamples: 1 })

  const save = (next: AssessmentDef[]): void => {
    run('Saving assessments', async () => {
      const saved = await window.art.assessments.saveDefs(next)
      setSnapshot({ ...useStore.getState().snapshot!, assessmentDefs: saved })
    })
  }

  const add = (): void => {
    save([
      ...defs,
      {
        partRated: draft.partRated,
        ratingType: draft.ratingType,
        ratingUnit: draft.ratingUnit,
        timing: draft.timing,
        ratingDate: '',
        description:
          [draft.ratingType, draft.partRated, draft.timing].filter(Boolean).join(' ') || 'Assessment',
        ordinal: defs.length,
        analyze: true,
        subsamples: Math.max(1, draft.subsamples || 1)
      }
    ])
    setDraft({ partRated: '', ratingType: '', ratingUnit: '', timing: '', subsamples: 1 })
  }

  const toggleAnalyze = (i: number): void => {
    save(defs.map((d, idx) => (idx === i ? { ...d, analyze: !d.analyze } : d)))
  }

  return (
    <div className="card">
      <h2>Core Assessments</h2>
      <p className="muted">
        The assessment schedule every site must collect. Sites may add their own extra columns but
        cannot change these.
      </p>
      {defs.length > 0 ? (
        <table className="data" style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th>Rating type</th>
              <th>Part rated</th>
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
                <td>{d.ratingType || '—'}</td>
                <td>{d.partRated || '—'}</td>
                <td>{d.ratingUnit || '—'}</td>
                <td>{d.timing || '—'}</td>
                <td className="num">{d.subsamples ?? 1}</td>
                <td className="num">
                  <input
                    type="checkbox"
                    checked={d.analyze}
                    disabled={readOnly}
                    onChange={() => toggleAnalyze(i)}
                    title="Include this assessment in ANOVA and the report"
                  />
                </td>
                {!readOnly && (
                  <td>
                    <button onClick={() => save(defs.filter((_, idx) => idx !== i))}>✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No core assessments defined{readOnly ? '.' : ' yet.'}</p>
      )}
      {!readOnly && (
        <div className="row">
          <div style={{ width: 160 }}>
            <label>Rating type</label>
            <input
              placeholder="e.g. CONTRO, PHYGEN"
              value={draft.ratingType}
              onChange={(e) => setDraft({ ...draft, ratingType: e.target.value })}
            />
          </div>
          <div style={{ width: 160 }}>
            <label>Part rated</label>
            <input
              placeholder="e.g. PLANT, LEAF"
              value={draft.partRated}
              onChange={(e) => setDraft({ ...draft, partRated: e.target.value })}
            />
          </div>
          <div style={{ width: 110 }}>
            <label>Unit</label>
            <input
              placeholder="%, count"
              value={draft.ratingUnit}
              onChange={(e) => setDraft({ ...draft, ratingUnit: e.target.value })}
            />
          </div>
          <div style={{ width: 130 }}>
            <label>Timing</label>
            <input
              placeholder="e.g. 14 DA-A"
              value={draft.timing}
              onChange={(e) => setDraft({ ...draft, timing: e.target.value })}
            />
          </div>
          <div style={{ width: 90 }}>
            <label>Subsamples</label>
            <input
              type="number"
              min={1}
              max={50}
              value={draft.subsamples}
              onChange={(e) => setDraft({ ...draft, subsamples: Number(e.target.value) })}
            />
          </div>
          <button className="primary" onClick={add}>
            + Add assessment
          </button>
        </div>
      )}
    </div>
  )
}
