import { Combobox } from '../../components/Combobox'
import type { Application, Treatment, TreatmentApplication } from '@shared/types'

/** One-line summary of a treatment's program, e.g. "A: Product X 1 L/ha · B: Product Y 0.5 L/ha". */
export function programSummary(t: Treatment): string {
  if (t.applications.length === 0) return 'no applications'
  return t.applications
    .map((l) => {
      const rate = [l.rate, l.rateUnit].filter(Boolean).join(' ')
      const head = l.applicationRef ? `${l.applicationRef}: ` : ''
      return `${head}${[l.product, rate].filter(Boolean).join(' ')}` || head + '—'
    })
    .join(' · ')
}

/**
 * Editable program (sequence of application lines) for one treatment. Each line pairs a product +
 * rate with an application timing (a defined application A/B/C, or unscheduled).
 */
export function TreatmentProgram({
  applications,
  crop,
  value,
  onChange,
  onCommit,
  disabled
}: {
  applications: Application[]
  crop: string
  value: TreatmentApplication[]
  /** Local update (per keystroke) — does not persist. */
  onChange: (lines: TreatmentApplication[]) => void
  /** Persist the given lines (on blur / discrete edits). Explicit lines avoid stale-state saves. */
  onCommit: (lines: TreatmentApplication[]) => void
  disabled?: boolean
}): JSX.Element {
  const update = (i: number, patch: Partial<TreatmentApplication>): void =>
    onChange(value.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  // Discrete edits (select/combobox/add/remove) persist immediately; text inputs persist on blur.
  const updateAndCommit = (i: number, patch: Partial<TreatmentApplication>): void => {
    const lines = value.map((l, idx) => (idx === i ? { ...l, ...patch } : l))
    onChange(lines)
    onCommit(lines)
  }
  const add = (): void => {
    const lines = [...value, { ordinal: value.length, applicationRef: '', product: '', rate: '', rateUnit: '' }]
    onChange(lines)
    onCommit(lines)
  }
  const remove = (i: number): void => {
    const lines = value.filter((_, idx) => idx !== i)
    onChange(lines)
    onCommit(lines)
  }

  return (
    <div className="treatment-program">
      {value.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Timing</th>
              <th>Product</th>
              <th style={{ width: 80 }}>Rate</th>
              <th style={{ width: 100 }}>Unit</th>
              {!disabled && <th style={{ width: 36 }}></th>}
            </tr>
          </thead>
          <tbody>
            {value.map((l, i) => (
              <tr key={i}>
                <td>
                  <select
                    disabled={disabled}
                    value={l.applicationRef}
                    onChange={(e) => updateAndCommit(i, { applicationRef: e.target.value })}
                  >
                    <option value="">— unscheduled —</option>
                    {applications.map((a) => (
                      <option key={a.id ?? a.timingCode} value={a.timingCode}>
                        Appl. {a.timingCode}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    disabled={disabled}
                    value={l.product}
                    placeholder="product / active"
                    onChange={(e) => update(i, { product: e.target.value })}
                    onBlur={() => onCommit(value)}
                  />
                </td>
                <td>
                  <input
                    disabled={disabled}
                    value={l.rate}
                    onChange={(e) => update(i, { rate: e.target.value })}
                    onBlur={() => onCommit(value)}
                  />
                </td>
                <td>
                  <Combobox
                    category="unit"
                    crop={crop}
                    disabled={disabled}
                    value={l.rateUnit}
                    onChange={(v) => updateAndCommit(i, { rateUnit: v })}
                  />
                </td>
                {!disabled && (
                  <td>
                    <button className="danger" title="Remove line" onClick={() => remove(i)}>
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!disabled && (
        <button style={{ marginTop: 8 }} onClick={add}>
          + Add application
        </button>
      )}
    </div>
  )
}
