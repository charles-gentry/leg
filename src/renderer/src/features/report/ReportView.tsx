import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { AssessmentHeader, MeanComparisonTest, AlphaLevel } from '@shared/types'
import { buildObservations } from '../stats/buildData'
import { MeansTable } from '../stats/MeansTable'
import { AnovaTable } from '../stats/AnovaTable'
import { TESTS } from '../stats/StatsView'

const MIN_OBS = 3 // ANOVA needs at least a few observations to be meaningful

function headerTitle(h: AssessmentHeader): string {
  return h.description || h.ratingType || `Assessment ${h.ordinal + 1}`
}

export function ReportView(): JSX.Element {
  const { snapshot, rEnv, aovResults, setAov, run } = useStore()
  const protocol = snapshot!.protocol
  const [test, setTest] = useState<MeanComparisonTest>('LSD')
  const [alpha, setAlpha] = useState<AlphaLevel>(0.05)

  const nameByNumber = useMemo(
    () => new Map(snapshot!.treatments.map((t) => [t.number, t.name || `Trt ${t.number}`])),
    [snapshot]
  )

  const rReady = !!(rEnv?.rscriptFound && rEnv?.agricolaeInstalled)

  // Assessments split by whether they participate in analysis.
  const analyzed = snapshot!.assessmentHeaders.filter((h) => h.analyze)
  const excluded = snapshot!.assessmentHeaders.filter((h) => !h.analyze)

  // Observations per analyzed assessment (also tells us which have enough data).
  const obsByHeader = useMemo(() => {
    const m = new Map<number, ReturnType<typeof buildObservations>>()
    for (const h of analyzed) m.set(h.id!, buildObservations(snapshot!, h.id!))
    return m
  }, [snapshot, analyzed])

  // Auto-run: analyze every eligible assessment on open and when test/alpha change.
  const runKey = `${snapshot!.filePath}|${test}|${alpha}`
  const ranFor = useRef<string>('')
  useEffect(() => {
    if (!rReady || ranFor.current === runKey) return
    const eligible = analyzed.filter((h) => (obsByHeader.get(h.id!)?.length ?? 0) >= MIN_OBS)
    if (eligible.length === 0) {
      ranFor.current = runKey
      return
    }
    ranFor.current = runKey
    run('Analyzing all assessments', async () => {
      for (const h of eligible) {
        const result = await window.arm.stats.runAov(h.id!, {
          design: protocol.design,
          test,
          alpha,
          data: obsByHeader.get(h.id!)!
        })
        setAov(h.id!, result)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, rReady])

  // Overview rows for every analyzed assessment (result may be pending/insufficient).
  const overview = analyzed.map((h) => {
    const result = aovResults[h.id!]
    const n = obsByHeader.get(h.id!)?.length ?? 0
    const trtRow = result?.anova.find((r) => r.source === 'treatment')
    return { h, result, n, pValue: trtRow?.pValue ?? null }
  })

  const exportCsv = (): void => {
    const rows: (string | number)[][] = [
      ['assessment', 'treatment_number', 'treatment_name', 'mean', 'group', 'n', 'std']
    ]
    for (const { h, result } of overview) {
      if (!result) continue
      for (const m of result.means) {
        rows.push([
          headerTitle(h),
          m.treatment,
          nameByNumber.get(m.treatment) ?? '',
          m.mean,
          m.group,
          m.n,
          m.std
        ])
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${protocol.title || 'trial'}-means.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const anyResults = overview.some((o) => o.result)

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Report</h2>
          <div className="row">
            <div style={{ width: 170 }}>
              <label>Mean comparison</label>
              <select value={test} onChange={(e) => setTest(e.target.value as MeanComparisonTest)}>
                {TESTS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ width: 90 }}>
              <label>Alpha</label>
              <select value={alpha} onChange={(e) => setAlpha(Number(e.target.value) as AlphaLevel)}>
                <option value={0.01}>0.01</option>
                <option value={0.05}>0.05</option>
                <option value={0.1}>0.10</option>
              </select>
            </div>
            <button onClick={exportCsv} disabled={!anyResults}>
              Export means CSV
            </button>
            <button className="primary" onClick={() => window.print()}>
              Print / Save PDF
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>{protocol.title || 'Untitled trial'}</h2>
        <table className="data" style={{ maxWidth: 640 }}>
          <tbody>
            <tr>
              <th style={{ width: 160 }}>Crop</th>
              <td>{protocol.crop || '—'}</td>
            </tr>
            <tr>
              <th>Target pest</th>
              <td>{protocol.targetPest || '—'}</td>
            </tr>
            <tr>
              <th>Investigator</th>
              <td>{protocol.investigator || '—'}</td>
            </tr>
            <tr>
              <th>Season</th>
              <td>{protocol.season || '—'}</td>
            </tr>
            <tr>
              <th>Design</th>
              <td>
                {protocol.design}, {protocol.replicates} replicates, {snapshot!.plots.length} plots
              </td>
            </tr>
            {snapshot!.trial && (
              <>
                <tr>
                  <th>Site</th>
                  <td>
                    {[snapshot!.trial.siteName, snapshot!.trial.location, snapshot!.trial.city]
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </td>
                </tr>
                <tr>
                  <th>Operator</th>
                  <td>{snapshot!.trial.operator || '—'}</td>
                </tr>
              </>
            )}
            <tr>
              <th>Protocol</th>
              <td>
                <code>{protocol.protocolUid.slice(0, 8) || '—'}</code> v{protocol.protocolVersion}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {!rReady && (
        <div className="card">
          <p className="muted">The statistics engine (R) is not ready — see the notice above.</p>
        </div>
      )}

      {analyzed.length === 0 ? (
        <div className="card">
          <p className="muted">No assessments are marked for analysis.</p>
        </div>
      ) : (
        <div className="card">
          <h2>Overview — Treatment Effect by Assessment</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Assessment</th>
                <th className="num">n</th>
                <th className="num">Grand mean</th>
                <th className="num">CV %</th>
                <th className="num">Critical value</th>
                <th className="num">Pr(&gt;F)</th>
                <th>Treatment effect</th>
              </tr>
            </thead>
            <tbody>
              {overview.map(({ h, result, n, pValue }) => (
                <tr key={h.id}>
                  <td>{headerTitle(h)}</td>
                  <td className="num">{n}</td>
                  {result ? (
                    <>
                      <td className="num">{result.grandMean.toFixed(3)}</td>
                      <td className="num">{result.cv.toFixed(2)}</td>
                      <td className="num">
                        {result.lsd != null ? `${result.criticalValueLabel} ${result.lsd.toFixed(3)}` : '—'}
                      </td>
                      <td className="num">{pValue != null ? pValue.toFixed(4) : ''}</td>
                      <td className={result.significant ? 'sig-yes' : 'sig-no'}>
                        {result.significant ? 'significant' : 'not significant'}
                      </td>
                    </>
                  ) : (
                    <td className="muted" colSpan={5}>
                      {n < MIN_OBS ? 'insufficient data' : rReady ? 'analyzing…' : 'R not ready'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {excluded.length > 0 && (
            <p className="muted" style={{ marginTop: 10 }}>
              Not analyzed: {excluded.map(headerTitle).join(', ')}
            </p>
          )}
        </div>
      )}

      {overview.map(({ h, result }) =>
        result ? (
          <div className="card" key={h.id}>
            <h2>{headerTitle(h)}</h2>
            <h3 style={{ margin: '4px 0' }}>Analysis of Variance</h3>
            <AnovaTable result={result} />
            <h3 style={{ margin: '16px 0 4px' }}>Treatment Means ({result.criticalValueLabel})</h3>
            <MeansTable result={result} treatments={snapshot!.treatments} />
          </div>
        ) : null
      )}
    </>
  )
}
