import { useState } from 'react'
import { useStore } from '../store'

/**
 * Shows R/agricolae setup guidance when the stats engine isn't ready. Lets the
 * user point at a custom Rscript path and re-check.
 */
export function REnvBanner(): JSX.Element | null {
  const { rEnv, setREnv } = useStore()
  const [path, setPath] = useState('')

  if (!rEnv || (rEnv.rscriptFound && rEnv.agricolaeInstalled)) return null

  return (
    <div className="banner no-print">
      <strong>Statistics engine not ready.</strong> {rEnv.message}
      <div className="row" style={{ marginTop: 8 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label>Custom Rscript path (optional)</label>
          <input
            placeholder="/usr/local/bin/Rscript"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </div>
        <button onClick={async () => setREnv(await window.arm.env.setRscriptPath(path))}>
          Re-check
        </button>
      </div>
    </div>
  )
}
