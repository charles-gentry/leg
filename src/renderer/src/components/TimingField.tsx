import { timingLabel } from '@shared/timing'
import type { Application } from '@shared/types'

/** The anchor state an assessment carries for its timing. */
export interface TimingValue {
  applicationRef: string
  daysAfter: number | null
  timing: string // free-text override
}

/**
 * Compact control to time an assessment relative to an application: pick an application, a
 * days-after offset, and see the derived label (e.g. "14 DA-A"). A free-text override wins when set.
 */
export function TimingField({
  applications,
  value,
  onChange,
  disabled
}: {
  applications: Application[]
  value: TimingValue
  onChange: (v: TimingValue) => void
  disabled?: boolean
}): JSX.Element {
  const derived = timingLabel(value)
  return (
    <div className="row" style={{ gap: 6, alignItems: 'flex-end', flexWrap: 'nowrap' }}>
      <div style={{ width: 70 }}>
        <label>Days</label>
        <input
          type="number"
          disabled={disabled || !value.applicationRef}
          value={value.daysAfter ?? ''}
          onChange={(e) =>
            onChange({ ...value, daysAfter: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
      </div>
      <div style={{ width: 90 }}>
        <label>after</label>
        <select
          disabled={disabled || applications.length === 0}
          value={value.applicationRef}
          onChange={(e) =>
            onChange({
              ...value,
              applicationRef: e.target.value,
              daysAfter: e.target.value && value.daysAfter == null ? 0 : value.daysAfter
            })
          }
        >
          <option value="">— none —</option>
          {applications.map((a) => (
            <option key={a.id ?? a.timingCode} value={a.timingCode}>
              Appl. {a.timingCode}
            </option>
          ))}
        </select>
      </div>
      <div style={{ width: 96 }}>
        <label title="Free-text timing; overrides the derived label">or exact</label>
        <input
          disabled={disabled}
          placeholder={derived || 'e.g. 14 DA-A'}
          value={value.timing}
          onChange={(e) => onChange({ ...value, timing: e.target.value })}
        />
      </div>
    </div>
  )
}
