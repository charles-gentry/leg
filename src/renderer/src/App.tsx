import { useEffect } from 'react'
import { useStore, type ViewId } from './store'
import { ProtocolView } from './features/protocol/ProtocolView'
import { SiteView } from './features/site/SiteView'
import { TrialMapView } from './features/trialmap/TrialMapView'
import { AssessmentsView } from './features/assessments/AssessmentsView'
import { StatsView } from './features/stats/StatsView'
import { ReportView } from './features/report/ReportView'
import { AuditView } from './features/audit/AuditView'
import { REnvBanner } from './components/REnvBanner'
import type { Role, ProjectSnapshot } from '@shared/types'

type OpenFn = () => Promise<ProjectSnapshot | null>

interface NavItem {
  id: ViewId
  label: string
  needsTrial?: boolean
  needsLock?: boolean // requires the layout to be confirmed & locked
}

// Navigation differs by role: a protocol is authored; a trial is implemented.
const NAV: Record<Role, NavItem[]> = {
  protocol: [
    { id: 'protocol', label: 'Protocol & Assessments' },
    { id: 'audit', label: 'Audit' }
  ],
  trial: [
    { id: 'protocol', label: 'Protocol (locked)' },
    { id: 'site', label: 'Site & Randomization' },
    { id: 'trialmap', label: 'Trial Map', needsTrial: true },
    { id: 'assessments', label: 'Assessments', needsTrial: true, needsLock: true },
    { id: 'stats', label: 'Statistics', needsTrial: true, needsLock: true },
    { id: 'report', label: 'Report', needsTrial: true, needsLock: true },
    { id: 'audit', label: 'Audit' }
  ]
}

function Welcome(): JSX.Element {
  const { setSnapshot, setView, run } = useStore()

  const openProtocol = (label: string, fn: OpenFn): void => {
    run(label, async () => {
      const s = await fn()
      if (s) {
        setSnapshot(s)
        setView('protocol')
      }
    })
  }

  const openTrial = (label: string, fn: OpenFn): void => {
    run(label, async () => {
      const s = await fn()
      if (s) {
        setSnapshot(s)
        setView(s.trial ? 'trialmap' : 'site')
      }
    })
  }

  return (
    <div className="welcome">
      <h1>Open ARM</h1>
      <p className="muted">
        Open-source Agricultural Research Manager
        <br />
        Author protocols, distribute them to trial sites, collect data, and analyze with ANOVA.
      </p>
      <div className="welcome-paths">
        <div className="card">
          <h2>Author a Protocol</h2>
          <p className="muted">
            Define treatments, design, and the assessment schedule, then distribute the protocol
            file to trial locations.
          </p>
          <div className="row">
            <button className="primary" onClick={() => openProtocol('Creating protocol', window.arm.protocol.new)}>
              New Protocol
            </button>
            <button onClick={() => openProtocol('Opening protocol', window.arm.protocol.open)}>
              Open Protocol…
            </button>
          </div>
        </div>
        <div className="card">
          <h2>Run a Trial</h2>
          <p className="muted">
            Implement a protocol at your site: generate your own randomization, enter data, and
            analyze. The protocol stays locked.
          </p>
          <div className="row">
            <button
              className="primary"
              onClick={() => openTrial('Creating trial', window.arm.trial.newFromProtocol)}
            >
              New Trial from Protocol…
            </button>
            <button onClick={() => openTrial('Opening trial', window.arm.trial.open)}>
              Open Trial…
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const { snapshot, view, setView, setSnapshot, setREnv, busy, error, setError, run } = useStore()

  useEffect(() => {
    window.arm.env.detectR().then(setREnv)
    window.arm.project.snapshot().then((s) => s && setSnapshot(s))
  }, [setREnv, setSnapshot])

  const role: Role = snapshot?.role ?? 'protocol'
  const hasTrial = !!snapshot?.trial
  const layoutLocked = !!snapshot?.trial?.layoutLockedAt
  const nav = NAV[role]

  return (
    <div className="app">
      {busy && <div className="busy-bar" title={busy} />}
      <header className="app-header">
        <h1>Open ARM</h1>
        {snapshot && (
          <span className={`role-badge ${role}`}>{role === 'trial' ? 'Trial' : 'Protocol'}</span>
        )}
        {snapshot && <span className="file">{snapshot.filePath}</span>}
        <div className="spacer" />
        {busy && <span className="muted">{busy}…</span>}
        {snapshot && (
          <>
            <button
              onClick={() =>
                run('Creating protocol', async () => {
                  const s = await window.arm.protocol.new()
                  if (s) {
                    setSnapshot(s)
                    setView('protocol')
                  }
                })
              }
            >
              New Protocol
            </button>
            <button
              onClick={() =>
                run('Opening file', async () => {
                  // Try a trial first, then a protocol (dialogs filter by extension).
                  const s = (await window.arm.trial.open()) ?? (await window.arm.protocol.open())
                  if (s) setSnapshot(s)
                })
              }
            >
              Open…
            </button>
          </>
        )}
      </header>

      <nav className="sidebar">
        {snapshot &&
          nav.map((n) => {
            const disabled = (n.needsTrial && !hasTrial) || (n.needsLock && !layoutLocked)
            const title = n.needsLock && !layoutLocked ? 'Confirm & lock the layout first' : undefined
            return (
              <button
                key={n.id}
                className={`nav-item ${view === n.id ? 'active' : ''}`}
                disabled={disabled}
                title={title}
                onClick={() => setView(n.id)}
              >
                {n.label}
              </button>
            )
          })}
      </nav>

      <main className="main">
        {!snapshot ? (
          <Welcome />
        ) : (
          <>
            <REnvBanner />
            {view === 'protocol' && <ProtocolView />}
            {view === 'site' && <SiteView />}
            {view === 'trialmap' && <TrialMapView />}
            {view === 'assessments' && <AssessmentsView />}
            {view === 'stats' && <StatsView />}
            {view === 'report' && <ReportView />}
            {view === 'audit' && <AuditView />}
          </>
        )}
      </main>

      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          {error} <span style={{ opacity: 0.7 }}>(click to dismiss)</span>
        </div>
      )}
    </div>
  )
}
