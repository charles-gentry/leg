import { useState, useMemo } from 'react'
import { useStore } from '../../store'

export function TrialMapView(): JSX.Element {
  const { snapshot, setSnapshot, setView, run } = useStore()
  const [selected, setSelected] = useState<number | null>(null)
  // Pending exclusion awaiting a reason (Electron has no window.prompt).
  const [excluding, setExcluding] = useState<{ plotId: number; plotNumber: number } | null>(null)
  const [reason, setReason] = useState('')
  const trial = snapshot!.trial!
  const protocol = snapshot!.protocol
  const plots = snapshot!.plots
  const locked = !!trial.layoutLockedAt

  const treatmentName = useMemo(() => {
    const m = new Map(snapshot!.treatments.map((t) => [t.id!, t]))
    return (id: number): string => {
      const t = m.get(id)
      return t ? `${t.number}. ${t.name || 'Trt ' + t.number}` : `#${id}`
    }
  }, [snapshot])

  // Unlocked: click two plots to swap. Locked: click a plot to toggle exclusion.
  const onCellClick = (plotId: number): void => {
    if (!locked) {
      if (selected === null) return setSelected(plotId)
      if (selected === plotId) return setSelected(null)
      const a = selected
      setSelected(null)
      run('Swapping plots', async () => setSnapshot(await window.arm.trial.swapPlots(a, plotId)))
      return
    }
    const plot = plots.find((p) => p.id === plotId)
    if (!plot) return
    if (plot.excluded) {
      run('Including plot', async () =>
        setSnapshot(await window.arm.trial.setPlotExcluded(plotId, false, ''))
      )
    } else {
      // Collect a reason via an in-app modal (Electron doesn't support window.prompt).
      setReason('')
      setExcluding({ plotId, plotNumber: plot.plotNumber })
    }
  }

  const confirmExclude = (): void => {
    if (!excluding || !reason.trim()) return
    const { plotId } = excluding
    setExcluding(null)
    run('Excluding plot', async () =>
      setSnapshot(await window.arm.trial.setPlotExcluded(plotId, true, reason.trim()))
    )
  }

  const confirmLock = (): void => {
    const ok = window.confirm(
      'Confirm & lock this layout?\n\nThis finalizes the randomization and enables data entry. ' +
        'The layout cannot be changed afterward (plots can only be excluded from analysis).'
    )
    if (!ok) return
    run('Locking layout', async () => {
      const next = await window.arm.trial.lockLayout()
      setSnapshot(next)
      setView('assessments')
    })
  }

  const excludedCount = plots.filter((p) => p.excluded).length

  const grid: (typeof plots)[number][][] = Array.from({ length: trial.plotRows }, () => [])
  for (const p of plots) grid[p.mapRow] = grid[p.mapRow] || []
  for (const p of plots) grid[p.mapRow][p.mapCol] = p

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h2 style={{ margin: 0 }}>
          Trial Map — {protocol.design}, {protocol.replicates} reps, {plots.length} plots
        </h2>
        {locked ? (
          <span className="lock-badge">🔒 Locked {new Date(trial.layoutLockedAt).toLocaleString()}</span>
        ) : (
          <button className="primary" onClick={confirmLock}>
            Confirm &amp; lock layout
          </button>
        )}
      </div>

      {locked ? (
        <p className="muted">
          Layout locked — the randomization is final. Click a plot to exclude it from analysis (or
          restore it); excluded plots keep their data but are omitted from statistics.
          {excludedCount > 0 && ` ${excludedCount} excluded.`}
        </p>
      ) : (
        <div className="banner">
          Draft layout — review it, re-randomize or swap plots as needed, then <strong>Confirm &amp;
          lock</strong> to enable data entry. Click two plots to swap their treatments.
          {selected !== null && ' Select a second plot to complete the swap.'}
        </div>
      )}

      <div
        className="trialmap"
        style={{ gridTemplateColumns: `repeat(${trial.plotCols}, minmax(90px, 1fr))` }}
      >
        {grid.flatMap((rowArr, r) =>
          rowArr.map((p, c) =>
            p ? (
              <div
                key={p.id}
                className={`plot-cell ${selected === p.id ? 'selected' : ''} ${p.excluded ? 'excluded' : ''}`}
                onClick={() => onCellClick(p.id!)}
                title={p.excluded ? `Excluded: ${p.excludeReason}` : undefined}
              >
                <div className="pnum">
                  Plot {p.plotNumber}
                  {p.excluded && <span className="excluded-tag">excluded</span>}
                </div>
                <div className="trt">{treatmentName(p.treatmentId)}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  Rep {p.rep}
                </div>
              </div>
            ) : (
              <div key={`${r}-${c}`} className="plot-cell" style={{ opacity: 0.3 }} />
            )
          )
        )}
      </div>

      {excluding && (
        <div className="modal-overlay" onClick={() => setExcluding(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Exclude plot #{excluding.plotNumber} from analysis</h3>
            <p className="muted">
              The plot's data is kept on record but omitted from all statistics. A reason is
              recorded in the audit trail.
            </p>
            <label>Reason</label>
            <textarea
              rows={3}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. treatment mis-applied in the field"
            />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setExcluding(null)}>Cancel</button>
              <button className="primary" disabled={!reason.trim()} onClick={confirmExclude}>
                Exclude plot
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
