import { useState, useMemo } from 'react'
import { useStore } from '../../store'
import type { MeanComparisonTest, AlphaLevel } from '@shared/types'
import { buildObservations } from './buildData'
import { MeansTable } from './MeansTable'
import { AnovaTable } from './AnovaTable'

export const TESTS: { id: MeanComparisonTest; label: string }[] = [
  { id: 'LSD', label: "Fisher's LSD" },
  { id: 'TUKEY', label: "Tukey's HSD" },
  { id: 'DUNCAN', label: "Duncan's MRT" },
  { id: 'SNK', label: 'Student-Newman-Keuls' }
]

export function StatsView(): JSX.Element {
  const { snapshot, rEnv, aovResults, setAov, run } = useStore()
  // Only assessments flagged for analysis are eligible.
  const headers = snapshot!.assessmentHeaders.filter((h) => h.analyze)
  const [headerId, setHeaderId] = useState<number | null>(headers[0]?.id ?? null)
  const [test, setTest] = useState<MeanComparisonTest>('LSD')
  const [alpha, setAlpha] = useState<AlphaLevel>(0.05)

  const obs = useMemo(
    () => (headerId ? buildObservations(snapshot!, headerId) : []),
    [snapshot, headerId]
  )
  const rReady = rEnv?.rscriptFound && rEnv?.agricolaeInstalled

  const runAnalysis = (): void => {
    if (!headerId) return
    run('Running ANOVA', async () => {
      const result = await window.arm.stats.runAov(headerId, {
        design: snapshot!.protocol.design,
        test,
        alpha,
        data: obs
      })
      setAov(headerId, result)
    })
  }

  const result = headerId != null ? aovResults[headerId] ?? null : null

  return (
    <>
      <div className="card">
        <h2>Statistics</h2>
        {!rReady && (
          <p className="muted">The statistics engine (R) is not ready — see the notice above.</p>
        )}
        {headers.length === 0 ? (
          <p className="muted">Define an assessment column and enter data first.</p>
        ) : (
          <div className="row">
            <div style={{ minWidth: 220 }}>
              <label>Assessment</label>
              <select
                value={headerId ?? ''}
                onChange={(e) => setHeaderId(Number(e.target.value))}
              >
                {headers.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.description || h.ratingType || `Assessment ${h.ordinal + 1}`}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ width: 190 }}>
              <label>Mean comparison</label>
              <select value={test} onChange={(e) => setTest(e.target.value as MeanComparisonTest)}>
                {TESTS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ width: 110 }}>
              <label>Alpha</label>
              <select
                value={alpha}
                onChange={(e) => setAlpha(Number(e.target.value) as AlphaLevel)}
              >
                <option value={0.01}>0.01</option>
                <option value={0.05}>0.05</option>
                <option value={0.1}>0.10</option>
              </select>
            </div>
            <button className="primary" disabled={!rReady || obs.length < 3} onClick={runAnalysis}>
              Run ANOVA
            </button>
            <span className="muted">{obs.length} observations</span>
          </div>
        )}
      </div>

      {result && (
        <>
          <div className="card">
            <h2>Analysis of Variance</h2>
            <AnovaTable result={result} />
          </div>

          <div className="card">
            <h2>Treatment Means</h2>
            <MeansTable result={result} treatments={snapshot!.treatments} />
          </div>
        </>
      )}
    </>
  )
}
