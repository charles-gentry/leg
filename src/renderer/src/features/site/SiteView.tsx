import { useState } from 'react'
import { useStore } from '../../store'
import type { SiteMetadata } from '@shared/types'

const FIELDS: { key: keyof SiteMetadata; label: string; width?: number }[] = [
  { key: 'siteName', label: 'Site name' },
  { key: 'operator', label: 'Operator / investigator' },
  { key: 'location', label: 'Location / field' },
  { key: 'city', label: 'City', width: 160 },
  { key: 'state', label: 'State / region', width: 160 },
  { key: 'country', label: 'Country', width: 160 },
  { key: 'plantingDate', label: 'Planting date', width: 160 }
]

/** Trial-only view: capture site metadata and generate this site's own randomization. */
export function SiteView(): JSX.Element {
  const { snapshot, setSnapshot, setView, run } = useStore()
  const protocol = snapshot!.protocol
  const trial = snapshot!.trial

  const initial: SiteMetadata = {
    siteName: trial?.siteName ?? '',
    operator: trial?.operator ?? '',
    location: trial?.location ?? '',
    city: trial?.city ?? '',
    state: trial?.state ?? '',
    country: trial?.country ?? '',
    plantingDate: trial?.plantingDate ?? '',
    trialNotes: trial?.trialNotes ?? ''
  }
  const [site, setSite] = useState<SiteMetadata>(initial)
  const [seedText, setSeedText] = useState(trial ? String(trial.seed) : '')

  const treatmentCount = snapshot!.treatments.length
  const canGenerate = treatmentCount >= 2

  const generate = (): void => {
    const seed = seedText.trim() === '' ? undefined : Number(seedText)
    run('Generating randomized trial', async () => {
      const next = await window.arm.trial.generate({ ...site, seed })
      setSnapshot(next)
      setView('trialmap')
    })
  }

  return (
    <>
      <div className="card">
        <h2>Site Information</h2>
        <p className="muted">
          Recorded on this trial file and included in the report returned to the protocol author.
        </p>
        <div className="field-grid">
          {FIELDS.map((f) => (
            <div key={f.key} style={f.width ? { width: f.width } : undefined}>
              <label>{f.label}</label>
              <input
                value={site[f.key]}
                onChange={(e) => setSite({ ...site, [f.key]: e.target.value })}
              />
            </div>
          ))}
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Trial notes</label>
            <textarea
              rows={2}
              value={site.trialNotes}
              onChange={(e) => setSite({ ...site, trialNotes: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Randomization</h2>
        <p className="muted">
          Design is fixed by the protocol:{' '}
          <strong>
            {protocol.design}, {protocol.replicates} replicates
          </strong>{' '}
          (from protocol — locked). This site generates its own randomized layout.
        </p>
        {trial?.layoutLockedAt ? (
          <div className="banner locked">
            🔒 Layout locked {new Date(trial.layoutLockedAt).toLocaleString()} — the randomization is
            final and can no longer be regenerated.
          </div>
        ) : (
          trial && (
            <div className="banner">
              A layout already exists for this site (seed {trial.seed}). Regenerating replaces it and
              clears any entered data.
            </div>
          )
        )}
        <div className="row">
          <div style={{ width: 200 }}>
            <label>Seed (blank = random)</label>
            <input
              type="number"
              placeholder="random"
              value={seedText}
              disabled={!!trial?.layoutLockedAt}
              onChange={(e) => setSeedText(e.target.value)}
            />
          </div>
          <button
            className="primary"
            disabled={!canGenerate || !!trial?.layoutLockedAt}
            onClick={generate}
          >
            {trial ? 'Regenerate' : 'Generate'} layout ({treatmentCount * protocol.replicates} plots)
          </button>
        </div>
        {treatmentCount < 2 && (
          <p className="muted">The protocol must define at least 2 treatments.</p>
        )}
      </div>
    </>
  )
}
