import { create } from 'zustand'
import {
  DEFAULT_RESOURCE_PROFILE,
  parseResourceProfile,
  resourceLimitsFor,
  type ResourceProcessSnapshot,
  type ResourceProfile,
  type ResourceProfileLimits
} from '@shared/contracts/resources'
import { applyRendererResourceProfile } from '@renderer/lib/resource-limits'
import { applyLiveTerminalScrollback } from '@renderer/lib/live-terminals'
import { isMonacoLoaded } from '@renderer/lib/monaco-status'
import { countWebChatGuests } from '@renderer/lib/web-chat-runtime'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useBrowserStore } from '@renderer/stores/browser-store'

export interface RendererResourceCensus {
  monacoLoaded: boolean
  webChatGuests: number
  webviewElements: number
  browserPanels: number
  projectCount: number
  ptyUiSessions: number
  busyCliSessions: number
}

interface ResourceStore {
  profile: ResourceProfile
  loaded: boolean
  snapshot: ResourceProcessSnapshot | null
  census: RendererResourceCensus | null
  hydrate: () => Promise<void>
  setProfile: (profile: ResourceProfile) => Promise<void>
  refreshSnapshot: () => Promise<void>
}

function collectCensus(): RendererResourceCensus {
  const sessions = useTerminalStore.getState().sessions
  let ptyUiSessions = 0
  let busyCliSessions = 0
  for (const status of Object.values(sessions)) {
    ptyUiSessions += 1
    if (status === 'busy' || status === 'starting') busyCliSessions += 1
  }
  return {
    monacoLoaded: isMonacoLoaded(),
    webChatGuests: countWebChatGuests(),
    webviewElements: typeof document === 'undefined' ? 0 : document.querySelectorAll('webview').length,
    browserPanels: Object.keys(useBrowserStore.getState().panels).length,
    projectCount: useWorkspaceStore.getState().projects.length,
    ptyUiSessions,
    busyCliSessions
  }
}

export const useResourceStore = create<ResourceStore>((set, get) => ({
  profile: DEFAULT_RESOURCE_PROFILE,
  loaded: false,
  snapshot: null,
  census: null,

  hydrate: async () => {
    const api = window.api?.resources
    if (!api) {
      applyRendererResourceProfile(DEFAULT_RESOURCE_PROFILE)
      applyLiveTerminalScrollback()
      set({ loaded: true, census: collectCensus() })
      return
    }
    try {
      const profile = parseResourceProfile(await api.getProfile())
      applyRendererResourceProfile(profile)
      applyLiveTerminalScrollback()
      set({ profile, loaded: true, census: collectCensus() })
    } catch {
      applyRendererResourceProfile(DEFAULT_RESOURCE_PROFILE)
      applyLiveTerminalScrollback()
      set({ loaded: true, census: collectCensus() })
    }
  },

  setProfile: async (next) => {
    const profile = parseResourceProfile(next)
    applyRendererResourceProfile(profile)
    applyLiveTerminalScrollback()
    set({ profile })
    const api = window.api?.resources
    if (!api) return
    const saved = parseResourceProfile(await api.setProfile(profile))
    applyRendererResourceProfile(saved)
    applyLiveTerminalScrollback()
    set({ profile: saved })
  },

  refreshSnapshot: async () => {
    const api = window.api?.resources
    const census = collectCensus()
    if (!api) {
      set({ census })
      return
    }
    try {
      const snapshot = await api.snapshot()
      set({ snapshot, census, profile: snapshot.profile })
      applyRendererResourceProfile(snapshot.profile)
      applyLiveTerminalScrollback()
    } catch {
      set({ census })
    }
  }
}))

export function currentStoreLimits(): ResourceProfileLimits {
  return resourceLimitsFor(useResourceStore.getState().profile)
}
