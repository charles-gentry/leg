import { create } from 'zustand'
import type { ProjectSnapshot, REnvStatus, AovResult } from '@shared/types'

export type ViewId = 'protocol' | 'site' | 'trialmap' | 'assessments' | 'stats' | 'report' | 'audit'

interface AppState {
  snapshot: ProjectSnapshot | null
  view: ViewId
  rEnv: REnvStatus | null
  busy: string | null // label of an in-flight operation, or null
  error: string | null
  /** Whether the left navigation sidebar is shown. Persisted across sessions. */
  sidebarOpen: boolean
  /** ANOVA results keyed by assessment header id, shared by Stats and Report. */
  aovResults: Record<number, AovResult>

  toggleSidebar: () => void
  setView: (v: ViewId) => void
  setSnapshot: (s: ProjectSnapshot | null) => void
  setREnv: (s: REnvStatus | null) => void
  setError: (e: string | null) => void
  setAov: (headerId: number, result: AovResult) => void
  resetAov: () => void
  /** Run an async op with a busy label + centralized error capture. */
  run: <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>
}

export const useStore = create<AppState>((set) => ({
  snapshot: null,
  view: 'protocol',
  rEnv: null,
  busy: null,
  error: null,
  sidebarOpen: localStorage.getItem('sidebarOpen') !== 'false',
  aovResults: {},

  toggleSidebar: () =>
    set((state) => {
      const sidebarOpen = !state.sidebarOpen
      localStorage.setItem('sidebarOpen', String(sidebarOpen))
      return { sidebarOpen }
    }),
  setView: (view) => set({ view }),
  setSnapshot: (snapshot) =>
    set((state) => {
      // Drop cached ANOVA results when switching to a different file.
      const changedFile =
        snapshot?.filePath !== state.snapshot?.filePath ? { aovResults: {} } : {}
      return { snapshot, ...changedFile }
    }),
  setREnv: (rEnv) => set({ rEnv }),
  setError: (error) => set({ error }),
  setAov: (headerId, result) =>
    set((state) => ({ aovResults: { ...state.aovResults, [headerId]: result } })),
  resetAov: () => set({ aovResults: {} }),

  run: async (label, fn) => {
    set({ busy: label, error: null })
    try {
      return await fn()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return undefined
    } finally {
      set({ busy: null })
    }
  }
}))
