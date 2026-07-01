import type { AovResult } from '@shared/types'

/** ANOVA source table (df/SS/MS/F/Pr>F) plus a summary chip row. */
export function AnovaTable({ result }: { result: AovResult }): JSX.Element {
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="chip">Grand mean {result.grandMean.toFixed(3)}</span>
        <span className="chip">CV {result.cv.toFixed(2)}%</span>
        {result.lsd != null && (
          <span className="chip">
            {result.criticalValueLabel} {result.lsd.toFixed(3)}
          </span>
        )}
        <span className={result.significant ? 'sig-yes' : 'sig-no'}>
          Treatment effect {result.significant ? 'significant' : 'not significant'} at α ={' '}
          {result.alpha}
        </span>
      </div>
      <table className="data">
        <thead>
          <tr>
            <th>Source</th>
            <th className="num">df</th>
            <th className="num">SS</th>
            <th className="num">MS</th>
            <th className="num">F</th>
            <th className="num">Pr(&gt;F)</th>
          </tr>
        </thead>
        <tbody>
          {result.anova.map((r) => (
            <tr key={r.source}>
              <td>{r.source}</td>
              <td className="num">{r.df}</td>
              <td className="num">{r.ss.toFixed(3)}</td>
              <td className="num">{r.ms.toFixed(3)}</td>
              <td className="num">{r.f != null ? r.f.toFixed(3) : ''}</td>
              <td className="num">{r.pValue != null ? r.pValue.toFixed(4) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
