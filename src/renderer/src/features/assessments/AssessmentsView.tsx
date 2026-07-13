import { useState } from 'react'
import { useStore } from '../../store'
import { Combobox } from '../../components/Combobox'
import { TimingField } from '../../components/TimingField'
import { timingLabel } from '@shared/timing'
import type { AssessmentHeader } from '@shared/types'

export function AssessmentsView(): JSX.Element {
  const snapshot = useStore((s) => s.snapshot)
  const setView = useStore((s) => s.setView)
  const trial = snapshot!.trial!
  const headers = snapshot!.assessmentHeaders
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
  headers: AssessmentHeader[]
}): JSX.Element {
  const { snapshot, setSnapshot, run } = useStore()
  const applications = snapshot!.applications
  const [draft, setDraft] = useState({
    partRated: '',
    ratingType: '',
    ratingUnit: '',
    applicationRef: '',
    daysAfter: null as number | null,
    timing: '',
    analyze: true,
    subsamples: 1
  })

  const add = (): void => {
    run('Adding assessment', async () => {
      const label = timingLabel(draft)
      const next = await window.art.assessments.addSiteHeader({
        trialId,
        partRated: draft.partRated,
        ratingType: draft.ratingType,
        ratingUnit: draft.ratingUnit,
        applicationRef: draft.applicationRef,
        daysAfter: draft.daysAfter,
        timing: draft.timing,
        ratingDate: '',
        description:
          [draft.ratingType, draft.partRated, label].filter(Boolean).join(' ') || 'Assessment',
        ordinal: headers.length,
        origin: 'site',
        locked: false,
        analyze: draft.analyze,
        subsamples: Math.max(1, draft.subsamples || 1)
      })
      // Refetch so the new coded terms surface in library suggestions/labels.
      const s = await window.art.project.snapshot()
      setSnapshot(s ?? { ...snapshot!, assessmentHeaders: next })
      setDraft({ partRated: '', ratingType: '', ratingUnit: '', applicationRef: '', daysAfter: null, timing: '', analyze: true, subsamples: 1 })
    })
  }

  const setSubsamples = (h: AssessmentHeader, n: number): void => {
    run('Updating assessment', async () => {
      const next = await window.art.assessments.upsertHeader({ ...h, subsamples: Math.max(1, n || 1) })
      setSnapshot({ ...snapshot!, assessmentHeaders: next })
    })
  }

  const remove = (id: number): void => {
    run('Removing assessment', async () => {
      const next = await window.art.assessments.deleteHeader(id)
      setSnapshot({ ...snapshot!, assessmentHeaders: next })
    })
  }

  const toggleAnalyze = (h: AssessmentHeader): void => {
    run('Updating assessment', async () => {
      const next = await window.art.assessments.upsertHeader({ ...h, analyze: !h.analyze })
      setSnapshot({ ...snapshot!, assessmentHeaders: next })
    })
  }

  return (
    <div className="card">
      <h2>Assessment Columns</h2>
      <p className="muted">
        Core columns are defined by the protocol (locked). You may add site-specific columns below.
      </p>
      {headers.length > 0 && (
        <table className="data" style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 70 }}>Source</th>
              <th>Rating type</th>
              <th>Part rated</th>
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
                <td>{h.ratingType || '—'}</td>
                <td>{h.partRated || '—'}</td>
                <td>{h.ratingUnit || '—'}</td>
                <td>{timingLabel(h) || '—'}</td>
                <td className="num">
                  {h.origin === 'core' ? (
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
                        : 'Include this assessment in ANOVA and the report'
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
          <label>Rating type</label>
          <Combobox
            category="rating_type"
            crop={snapshot!.protocol.crop}
            value={draft.ratingType}
            onChange={(v) => setDraft({ ...draft, ratingType: v })}
          />
        </div>
        <div style={{ width: 160 }}>
          <label>Part rated</label>
          <Combobox
            category="part_rated"
            crop={snapshot!.protocol.crop}
            value={draft.partRated}
            onChange={(v) => setDraft({ ...draft, partRated: v })}
          />
        </div>
        <div style={{ width: 110 }}>
          <label>Unit</label>
          <Combobox
            category="unit"
            crop={snapshot!.protocol.crop}
            value={draft.ratingUnit}
            onChange={(v) => setDraft({ ...draft, ratingUnit: v })}
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
            onChange={(e) => setDraft({ ...draft, subsamples: Number(e.target.value) })}
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
        <button className="primary" onClick={add}>
          + Add column
        </button>
      </div>
    </div>
  )
}
