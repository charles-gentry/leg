import { create } from 'zustand'
import type { ProjectSnapshot, REnvStatus, AovResult } from '@shared/types'

export type ViewId =
  | 'protocol'
  | 'site'
  | 'trialmap'
  | 'assessments'
  | 'dataentry'
  | 'stats'
  | 'report'
  | 'documents'
  | 'library'
  | 'audit'

/** Which printable document the Documents view renders (selected from the Print menu). */
export type DocKind = 'fieldmap' | 'labels' | 'datasheet' | 'spray' | 'summary'

interface AppState {
  snapshot: ProjectSnapshot | null
  view: ViewId
  rEnv: REnvStatus | null
  busy: string | null // label of an in-flight operation, or null
  error: string | null
  /** Transient success/info confirmation (distinct from error). */
  notice: string | null
  /** Briefly true just after a save/mutation completes (drives the header "Saved" flash). */
  saved: boolean
  /** Whether the left navigation sidebar is shown. Persisted across sessions. */
  sidebarOpen: boolean
  /** ANOVA results keyed by assessment header id, shared by Stats and Report. */
  aovResults: Record<number, AovResult>

  /** The printable document currently selected for the Documents view. */
  docKind: DocKind

  toggleSidebar: () => void
  setView: (v: ViewId) => void
  setDocKind: (k: DocKind) => void
  setSnapshot: (s: ProjectSnapshot | null) => void
  setREnv: (s: REnvStatus | null) => void
  setError: (e: string | null) => void
  setNotice: (n: string | null) => void
  setAov: (headerId: number, result: AovResult) => void
  resetAov: () => void
  /** Run an async op with a busy label + centralized error capture. */
  run: <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined
let savedTimer: ReturnType<typeof setTimeout> | undefined

export const useStore = create<AppState>((set) => ({
  snapshot: null,
  view: 'protocol',
  rEnv: null,
  busy: null,
  error: null,
  notice: null,
  saved: false,
  sidebarOpen: localStorage.getItem('sidebarOpen') !== 'false',
  aovResults: {},
  docKind: 'fieldmap',

  toggleSidebar: () =>
    set((state) => {
      const sidebarOpen = !state.sidebarOpen
      localStorage.setItem('sidebarOpen', String(sidebarOpen))
      return { sidebarOpen }
    }),
  setView: (view) => set({ view }),
  setDocKind: (docKind) => set({ docKind }),
  setSnapshot: (snapshot) =>
    set((state) => {
      // Drop cached ANOVA results when switching to a different file.
      const changedFile =
        snapshot?.filePath !== state.snapshot?.filePath ? { aovResults: {} } : {}
      return { snapshot, ...changedFile }
    }),
  setREnv: (rEnv) => set({ rEnv }),
  setError: (error) => set({ error }),
  setNotice: (notice) => {
    set({ notice })
    if (noticeTimer) clearTimeout(noticeTimer)
    // Success/info notices are transient; errors stay until dismissed.
    if (notice) noticeTimer = setTimeout(() => set({ notice: null }), 4000)
  },
  setAov: (headerId, result) =>
    set((state) => ({ aovResults: { ...state.aovResults, [headerId]: result } })),
  resetAov: () => set({ aovResults: {} }),

  run: async (label, fn) => {
    set({ busy: label, error: null, saved: false })
    let ok = false
    try {
      const r = await fn()
      ok = true
      return r
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return undefined
    } finally {
      set({ busy: null })
      // Briefly confirm silent autosaves/mutations (not reads like opening/analyzing).
      if (ok && /^(Saving|Adding|Updating|Removing|Renaming|Swapping|Excluding|Including|Locking|Generating)/.test(label)) {
        set({ saved: true })
        if (savedTimer) clearTimeout(savedTimer)
        savedTimer = setTimeout(() => set({ saved: false }), 1400)
      }
    }
  }
}))
