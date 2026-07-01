import { useMemo, useState } from 'react'
import { DataSheetGrid, keyColumn, floatColumn, textColumn } from 'react-datasheet-grid'
import 'react-datasheet-grid/dist/style.css'
import { useStore } from '../../store'
import type { AssessmentHeader, AssessmentValue } from '@shared/types'

type GridRow = Record<string, number | string | null>

export function AssessmentsView(): JSX.Element {
  const { snapshot, setSnapshot, run } = useStore()
  const trial = snapshot!.trial!
  const headers = snapshot!.assessmentHeaders
  const treatmentName = useMemo(() => {
    const m = new Map(snapshot!.treatments.map((t) => [t.id!, t]))
    return (id: number): string => {
      const t = m.get(id)
      return t ? `${t.number}. ${t.name || 'Trt ' + t.number}` : `#${id}`
    }
  }, [snapshot])

  // value lookup: `${headerId}:${plotId}` -> value
  const valueMap = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const v of snapshot!.assessmentValues) m.set(`${v.assessmentHeaderId}:${v.plotId}`, v.value)
    return m
  }, [snapshot])

  const rows: GridRow[] = useMemo(
    () =>
      snapshot!.plots.map((p) => {
        const row: GridRow = {
          plotId: p.id!,
          plot: p.plotNumber,
          rep: p.rep,
          treatment: treatmentName(p.treatmentId)
        }
        for (const h of headers) row[`h_${h.id}`] = valueMap.get(`${h.id}:${p.id}`) ?? null
        return row
      }),
    [snapshot, headers, valueMap, treatmentName]
  )

  const columns = useMemo(
    () => [
      { ...keyColumn('plot', textColumn), title: 'Plot', disabled: true, width: 0.5 },
      { ...keyColumn('rep', textColumn), title: 'Rep', disabled: true, width: 0.4 },
      { ...keyColumn('treatment', textColumn), title: 'Treatment', disabled: true, width: 1.4 },
      ...headers.map((h) => ({
        ...keyColumn(`h_${h.id}`, floatColumn),
        title: h.description || h.ratingType || `Assessment ${h.ordinal + 1}`
      }))
    ],
    [headers]
  )

  const onChange = (next: GridRow[]): void => {
    // Persist only changed cells to keep writes minimal.
    const changes: AssessmentValue[] = []
    next.forEach((row, i) => {
      const plotId = rows[i].plotId as number
      for (const h of headers) {
        const key = `h_${h.id}`
        const before = rows[i][key]
        const after = row[key]
        if (before !== after) {
          changes.push({
            assessmentHeaderId: h.id!,
            plotId,
            value: after === null || after === '' ? null : Number(after)
          })
        }
      }
    })
    if (changes.length === 0) return
    run('Saving data', async () => {
      for (const c of changes) await window.arm.assessments.setValue(c)
      // Reflect changes locally without a full round-trip.
      const map = new Map(
        snapshot!.assessmentValues.map((v) => [`${v.assessmentHeaderId}:${v.plotId}`, v])
      )
      for (const c of changes) map.set(`${c.assessmentHeaderId}:${c.plotId}`, c)
      setSnapshot({ ...snapshot!, assessmentValues: [...map.values()] })
    })
  }

  return (
    <>
      <HeaderManager trialId={trial.id!} headers={headers} />
      <div className="card">
        <h2>Data Entry</h2>
        {headers.length === 0 ? (
          <p className="muted">Add an assessment column above to begin entering data.</p>
        ) : (
          <>
            <p className="muted">
              Rows are plots. Paste a column of values from a spreadsheet directly into a cell.
            </p>
            <DataSheetGrid value={rows} columns={columns} onChange={onChange} lockRows />
          </>
        )}
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
  const [draft, setDraft] = useState({ partRated: '', ratingType: '', ratingUnit: '', timing: '', analyze: true })

  const add = (): void => {
    run('Adding assessment', async () => {
      const next = await window.arm.assessments.addSiteHeader({
        trialId,
        partRated: draft.partRated,
        ratingType: draft.ratingType,
        ratingUnit: draft.ratingUnit,
        timing: draft.timing,
        ratingDate: '',
        description:
          [draft.ratingType, draft.partRated, draft.timing].filter(Boolean).join(' ') || 'Assessment',
        ordinal: headers.length,
        origin: 'site',
        locked: false,
        analyze: draft.analyze
      })
      setSnapshot({ ...snapshot!, assessmentHeaders: next })
      setDraft({ partRated: '', ratingType: '', ratingUnit: '', timing: '', analyze: true })
    })
  }

  const remove = (id: number): void => {
    run('Removing assessment', async () => {
      const next = await window.arm.assessments.deleteHeader(id)
      setSnapshot({ ...snapshot!, assessmentHeaders: next })
    })
  }

  const toggleAnalyze = (h: AssessmentHeader): void => {
    run('Updating assessment', async () => {
      const next = await window.arm.assessments.upsertHeader({ ...h, analyze: !h.analyze })
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
                <td>{h.timing || '—'}</td>
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
                <td>{h.origin === 'core' || h.locked ? null : <button onClick={() => remove(h.id!)}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
