import { create } from 'zustand'
import {
  DEFAULT_CUSTOM_VIEWPORT_WIDTH,
  type BrowserViewportId
} from '@shared/contracts/browser'

const STORAGE_KEY = 'bikorch.browser'
const MAX_RECENTS = 12

export interface BrowserPanelState {
  url: string
  viewport: BrowserViewportId
  customWidth: number
}

interface StoredBrowser {
  recents: string[]
  panels: Record<string, BrowserPanelState>
}

function readStored(): StoredBrowser {
  if (typeof window === 'undefined') return { recents: [], panels: {} }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { recents: [], panels: {} }
    const parsed = JSON.parse(raw) as Partial<StoredBrowser>
    return {
      recents: Array.isArray(parsed.recents)
        ? parsed.recents.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENTS)
        : [],
      panels: parsed.panels && typeof parsed.panels === 'object' ? parsed.panels : {}
    }
  } catch {
    return { recents: [], panels: {} }
  }
}

function persist(state: StoredBrowser): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore quota / private-mode failures.
  }
}

const defaultPanel = (): BrowserPanelState => ({
  url: '',
  viewport: 'fluid',
  customWidth: DEFAULT_CUSTOM_VIEWPORT_WIDTH
})

const initial = readStored()

interface BrowserStore {
  recents: string[]
  panels: Record<string, BrowserPanelState>
  ensure: (panelId: string) => BrowserPanelState
  rememberUrl: (panelId: string, url: string) => void
  setViewport: (panelId: string, viewport: BrowserViewportId) => void
  setCustomWidth: (panelId: string, width: number) => void
}

export const useBrowserStore = create<BrowserStore>((set, get) => ({
  recents: initial.recents,
  panels: initial.panels,

  ensure: (panelId) => {
    const existing = get().panels[panelId]
    if (existing) return existing
    const next = defaultPanel()
    set((state) => ({ panels: { ...state.panels, [panelId]: next } }))
    return next
  },

  rememberUrl: (panelId, url) => {
    const current = get().panels[panelId] ?? defaultPanel()
    const recents = [url, ...get().recents.filter((item) => item !== url)].slice(0, MAX_RECENTS)
    const panels = { ...get().panels, [panelId]: { ...current, url } }
    set({ recents, panels })
    persist({ recents, panels })
  },

  setViewport: (panelId, viewport) => {
    const current = get().panels[panelId] ?? defaultPanel()
    const panels = { ...get().panels, [panelId]: { ...current, viewport } }
    set({ panels })
    persist({ recents: get().recents, panels })
  },

  setCustomWidth: (panelId, width) => {
    const current = get().panels[panelId] ?? defaultPanel()
    const customWidth = Math.min(2560, Math.max(240, Math.round(width)))
    const panels: Record<string, BrowserPanelState> = {
      ...get().panels,
      [panelId]: { ...current, customWidth, viewport: 'custom' }
    }
    set({ panels })
    persist({ recents: get().recents, panels })
  }
}))
