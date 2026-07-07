import { useEffect } from 'react'
import { useStore, type ViewId } from './store'
import { ProtocolView } from './features/protocol/ProtocolView'
import { SiteView } from './features/site/SiteView'
import { TrialMapView } from './features/trialmap/TrialMapView'
import { AssessmentsView } from './features/assessments/AssessmentsView'
import { DataEntryView } from './features/assessments/DataEntryView'
import { StatsView } from './features/stats/StatsView'
import { ReportView } from './features/report/ReportView'
import { AuditView } from './features/audit/AuditView'
import { REnvBanner } from './components/REnvBanner'
import { validateDesign } from '@shared/design'
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
    { id: 'dataentry', label: 'Data Entry', needsTrial: true, needsLock: true },
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
      <h1>ART</h1>
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
            <button className="primary" onClick={() => openProtocol('Creating protocol', window.art.protocol.new)}>
              New Protocol
            </button>
            <button onClick={() => openProtocol('Opening protocol', window.art.protocol.open)}>
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
              onClick={() => openTrial('Creating trial', window.art.trial.newFromProtocol)}
            >
              New Trial from Protocol…
            </button>
            <button onClick={() => openTrial('Opening trial', window.art.trial.open)}>
              Open Trial…
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const { snapshot, view, setView, setSnapshot, setREnv, busy, error, setError, run, sidebarOpen, toggleSidebar } =
    useStore()

  // Pick a sensible starting view for a freshly opened/created document.
  const applySnapshot = (s: ProjectSnapshot): void => {
    setSnapshot(s)
    setView(s.role === 'trial' ? (s.trial ? 'trialmap' : 'site') : 'protocol')
  }

  const doNewProtocol = (): void =>
    void run('Creating protocol', async () => {
      const s = await window.art.protocol.new()
      if (s) applySnapshot(s)
    })
  const doOpen = (): void =>
    void run('Opening file', async () => {
      // Try a trial first, then a protocol (dialogs filter by extension).
      const s = (await window.art.trial.open()) ?? (await window.art.protocol.open())
      if (s) applySnapshot(s)
    })
  const doOpenTrial = (): void =>
    void run('Opening trial', async () => {
      const s = await window.art.trial.open()
      if (s) applySnapshot(s)
    })
  const doNewFromProtocol = (): void =>
    void run('Creating trial', async () => {
      const s = await window.art.trial.newFromProtocol()
      if (s) applySnapshot(s)
    })
  const doNewFromCurrent = (): void =>
    void run('Creating trial', async () => {
      const s = await window.art.trial.newFromCurrent()
      if (s) applySnapshot(s)
    })
  const doClose = (): void =>
    void run('Closing file', async () => {
      await window.art.project.close()
      setSnapshot(null)
    })

  useEffect(() => {
    window.art.env.detectR().then(setREnv)
    window.art.project.snapshot().then((s) => s && applySnapshot(s))
    // React to native-menu actions.
    return window.art.menu.onAction((action) => {
      switch (action) {
        case 'protocol.new': doNewProtocol(); break
        case 'file.open': doOpen(); break
        case 'trial.open': doOpenTrial(); break
        case 'trial.newFromProtocol': doNewFromProtocol(); break
        case 'trial.newFromCurrent': doNewFromCurrent(); break
        case 'file.close': doClose(); break
        case 'sidebar.toggle': toggleSidebar(); break
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const role: Role = snapshot?.role ?? 'protocol'
  const hasTrial = !!snapshot?.trial
  const layoutLocked = !!snapshot?.trial?.layoutLockedAt
  const nav = NAV[role]
  const protocolDesignOk = snapshot
    ? validateDesign(
        snapshot.protocol.design,
        snapshot.protocol.replicates,
        snapshot.protocol.blockSize,
        snapshot.treatments.length
      ).ok
    : true

  // Keep the native menu's applicability in sync with the open document.
  useEffect(() => {
    window.art.menu.setState({ role: snapshot?.role ?? null, hasDocument: !!snapshot })
  }, [snapshot])

  return (
    <div className={`app${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
      {busy && <div className="busy-bar" title={busy} />}
      <header className="app-header">
        <h1>ART</h1>
        {snapshot && (
          <span className={`role-badge ${role}`}>{role === 'trial' ? 'Trial' : 'Protocol'}</span>
        )}
        {snapshot && <span className="file">{snapshot.filePath}</span>}
        <div className="spacer" />
        {busy && <span className="muted">{busy}…</span>}
        {snapshot && role === 'protocol' && (
          <button
            className="primary"
            onClick={doNewFromCurrent}
            disabled={!protocolDesignOk}
            title={protocolDesignOk ? undefined : 'The protocol design is non-conformant — see the Protocol tab.'}
          >
            Create Trial from this Protocol →
          </button>
        )}
      </header>

      <nav className="sidebar">
        <button
          className="sidebar-toggle"
          title={sidebarOpen ? 'Collapse sidebar (Ctrl+B)' : 'Expand sidebar (Ctrl+B)'}
          aria-label="Toggle sidebar"
          onClick={toggleSidebar}
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>
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
            {view === 'dataentry' && <DataEntryView />}
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
