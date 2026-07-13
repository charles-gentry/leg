import { useStore } from '../../store'
import { Combobox } from '../../components/Combobox'
import type { Application } from '@shared/types'

/**
 * Protocol applications — the timing *plan* (A/B/C…): each a timing code + intended crop growth
 * stage. Assessments anchor their timing to these; the actual date each happened is recorded per
 * trial (Site tab). Read-only inside a locked trial.
 */
export function ApplicationsEditor({ readOnly }: { readOnly: boolean }): JSX.Element {
  const { snapshot, setSnapshot, run } = useStore()
  const apps = snapshot!.applications
  const crop = snapshot!.protocol.crop

  const save = (next: Application[]): void => {
    run('Saving applications', async () => {
      await window.art.applications.save(next.map((a, i) => ({ ...a, ordinal: i })))
      const s = await window.art.project.snapshot()
      if (s) setSnapshot(s)
    })
  }

  const nextCode = (): string => {
    // Suggest the next letter A, B, C… not already used.
    const used = new Set(apps.map((a) => a.timingCode))
    for (let i = 0; i < 26; i++) {
      const c = String.fromCharCode(65 + i)
      if (!used.has(c)) return c
    }
    return ''
  }

  const add = (): void =>
    save([...apps, { ordinal: apps.length, timingCode: nextCode(), targetGrowthStage: '', description: '' }])
  const update = (i: number, patch: Partial<Application>): void =>
    save(apps.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  const remove = (i: number): void => save(apps.filter((_, idx) => idx !== i))

  return (
    <div className="card">
      <h2>Applications</h2>
      <p className="muted">
        The treatment-application schedule (A, B, C…). Assessments can be timed relative to an
        application (e.g. &quot;14&nbsp;DA-A&quot;). The date each application actually happens is
        recorded per trial site.
      </p>
      {apps.length > 0 && (
        <table className="data" style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 70 }}>Timing</th>
              <th style={{ width: 200 }}>Target growth stage</th>
              <th>Description</th>
              {!readOnly && <th style={{ width: 40 }}></th>}
            </tr>
          </thead>
          <tbody>
            {apps.map((a, i) => (
              <tr key={a.id ?? i}>
                <td>
                  <input
                    style={{ width: 54 }}
                    disabled={readOnly}
                    value={a.timingCode}
                    onChange={(e) => update(i, { timingCode: e.target.value.toUpperCase().slice(0, 4) })}
                  />
                </td>
                <td>
                  <Combobox
                    category="growth_stage"
                    crop={crop}
                    disabled={readOnly}
                    value={a.targetGrowthStage}
                    onChange={(v) => update(i, { targetGrowthStage: v })}
                  />
                </td>
                <td>
                  <input
                    disabled={readOnly}
                    value={a.description}
                    placeholder="e.g. first fungicide spray"
                    onChange={(e) => update(i, { description: e.target.value })}
                  />
                </td>
                {!readOnly && (
                  <td>
                    <button className="danger" title="Remove application" onClick={() => remove(i)}>
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!readOnly && <button onClick={add}>+ Add application</button>}
    </div>
  )
}
