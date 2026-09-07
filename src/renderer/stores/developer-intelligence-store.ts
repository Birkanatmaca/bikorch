import { create } from 'zustand'
import {
  createDefaultDeveloperIntelligenceSettings,
  type AnalyzeMemoriesResult,
  type ClearTarget,
  type DeveloperIntelligenceExportResult,
  type DeveloperIntelligenceSettings,
  type DeveloperIntelligenceStats,
  type DeveloperMemory,
  type DeveloperMetrics,
  type MemoryContextPackage,
  type MemoryContextRequest,
  type MemoryDraft,
  type MemoryUpdate,
  type MetricsRangeKey,
  type PromptHistoryFilter,
  type PromptHistoryPage
} from '@shared/contracts/developer-intelligence'

export type ProfileSection =
  | 'overview'
  | 'insights'
  | 'accounts'
  | 'costs'
  | 'prompts'
  | 'memory'
  | 'privacy'

interface MetricsProject {
  id: string
  name: string
  folderPath: string | null
}

interface DeveloperIntelligenceStore {
  settings: DeveloperIntelligenceSettings
  settingsLoaded: boolean
  section: ProfileSection
  range: MetricsRangeKey
  metrics: DeveloperMetrics | null
  metricsLoading: boolean
  metricsError: string | null
  prompts: PromptHistoryPage
  promptsLoading: boolean
  promptFilter: PromptHistoryFilter
  memories: DeveloperMemory[]
  memoriesLoaded: boolean
  stats: DeveloperIntelligenceStats | null
  analysis: AnalyzeMemoriesResult | null
  analysisLoading: boolean
  contextPreview: MemoryContextPackage | null
  contextLoading: boolean
  /** Incremented whenever new activity is recorded so open views can refresh. */
  activityVersion: number

  setSection: (section: ProfileSection) => void
  setRange: (range: MetricsRangeKey) => void
  noteActivity: () => void
  loadSettings: () => Promise<void>
  updateSettings: (updates: Partial<DeveloperIntelligenceSettings>) => Promise<void>
  loadMetrics: (projects: MetricsProject[]) => Promise<void>
  setPromptFilter: (filter: PromptHistoryFilter) => void
  loadPrompts: () => Promise<void>
  deletePrompts: (ids: string[] | 'all') => Promise<void>
  loadMemories: () => Promise<void>
  createMemory: (draft: MemoryDraft) => Promise<void>
  updateMemory: (id: string, updates: MemoryUpdate) => Promise<void>
  deleteMemory: (id: string) => Promise<void>
  loadStats: () => Promise<void>
  analyzeMemories: (projects: MetricsProject[]) => Promise<AnalyzeMemoriesResult | null>
  loadContextPreview: (request: MemoryContextRequest) => Promise<MemoryContextPackage | null>
  exportData: () => Promise<DeveloperIntelligenceExportResult | null>
  clear: (target: ClearTarget) => Promise<void>
}

const EMPTY_PAGE: PromptHistoryPage = { items: [], total: 0 }

function api(): Window['api']['developerIntelligence'] | null {
  return typeof window !== 'undefined' && window.api?.developerIntelligence
    ? window.api.developerIntelligence
    : null
}

export const useDeveloperIntelligenceStore = create<DeveloperIntelligenceStore>((set, get) => ({
  settings: createDefaultDeveloperIntelligenceSettings(),
  settingsLoaded: false,
  section: 'overview',
  range: '7d',
  metrics: null,
  metricsLoading: false,
  metricsError: null,
  prompts: EMPTY_PAGE,
  promptsLoading: false,
  promptFilter: { limit: 50, offset: 0 },
  memories: [],
  memoriesLoaded: false,
  stats: null,
  analysis: null,
  analysisLoading: false,
  contextPreview: null,
  contextLoading: false,
  activityVersion: 0,

  setSection: (section) => set({ section }),
  setRange: (range) => set({ range }),
  noteActivity: () => set((state) => ({ activityVersion: state.activityVersion + 1 })),

  loadSettings: async () => {
    const bridge = api()
    if (!bridge) return
    try {
      const settings = await bridge.getSettings()
      set({ settings, settingsLoaded: true })
    } catch {
      set({ settingsLoaded: true })
    }
  },

  updateSettings: async (updates) => {
    const bridge = api()
    const optimistic = { ...get().settings, ...updates }
    set({ settings: optimistic })
    if (!bridge) return
    try {
      const settings = await bridge.updateSettings(updates)
      set({ settings, settingsLoaded: true })
      void get().loadStats()
    } catch {
      void get().loadSettings()
    }
  },

  loadMetrics: async (projects) => {
    const bridge = api()
    if (!bridge) return
    set({ metricsLoading: true, metricsError: null })
    try {
      const metrics = await bridge.getMetrics({ range: get().range, projects })
      set({ metrics, metricsLoading: false })
    } catch (error) {
      set({
        metricsLoading: false,
        metricsError: error instanceof Error ? error.message : 'Could not compute metrics'
      })
    }
  },

  setPromptFilter: (filter) => set({ promptFilter: { limit: 50, offset: 0, ...filter } }),

  loadPrompts: async () => {
    const bridge = api()
    if (!bridge) return
    set({ promptsLoading: true })
    try {
      const prompts = await bridge.listPrompts(get().promptFilter)
      set({ prompts, promptsLoading: false })
    } catch {
      set({ prompts: EMPTY_PAGE, promptsLoading: false })
    }
  },

  deletePrompts: async (ids) => {
    const bridge = api()
    if (!bridge) return
    try {
      await bridge.deletePrompts(ids)
    } finally {
      await get().loadPrompts()
      void get().loadStats()
    }
  },

  loadMemories: async () => {
    const bridge = api()
    if (!bridge) return
    try {
      const memories = await bridge.listMemories()
      set({ memories, memoriesLoaded: true })
    } catch {
      set({ memoriesLoaded: true })
    }
  },

  createMemory: async (draft) => {
    const bridge = api()
    if (!bridge) return
    const memory = await bridge.createMemory(draft)
    if (memory) set((state) => ({ memories: [memory, ...state.memories] }))
    void get().loadStats()
  },

  updateMemory: async (id, updates) => {
    const bridge = api()
    if (!bridge) return
    const memory = await bridge.updateMemory(id, updates)
    if (memory) {
      set((state) => ({
        memories: state.memories.map((item) => (item.id === id ? memory : item))
      }))
    }
  },

  deleteMemory: async (id) => {
    const bridge = api()
    if (!bridge) return
    await bridge.deleteMemory(id)
    set((state) => ({ memories: state.memories.filter((item) => item.id !== id) }))
    void get().loadStats()
  },

  loadStats: async () => {
    const bridge = api()
    if (!bridge) return
    try {
      set({ stats: await bridge.getStats() })
    } catch {
      // stats are informational only
    }
  },

  analyzeMemories: async (projects) => {
    const bridge = api()
    if (!bridge) return null
    set({ analysisLoading: true })
    try {
      const analysis = await bridge.analyzeMemories({ range: get().range, projects })
      set({ analysis, analysisLoading: false })
      await Promise.all([get().loadMemories(), get().loadStats()])
      return analysis
    } catch {
      set({ analysisLoading: false })
      return null
    }
  },

  loadContextPreview: async (request) => {
    const bridge = api()
    if (!bridge) return null
    set({ contextLoading: true })
    try {
      const contextPreview = await bridge.getContext(request)
      set({ contextPreview, contextLoading: false })
      return contextPreview
    } catch {
      set({ contextPreview: null, contextLoading: false })
      return null
    }
  },

  exportData: async () => {
    const bridge = api()
    if (!bridge) return null
    try {
      return await bridge.exportData()
    } catch {
      return null
    }
  },

  clear: async (target) => {
    const bridge = api()
    if (!bridge) return
    await bridge.clear(target)
    if (target === 'all') set({ settings: createDefaultDeveloperIntelligenceSettings() })
    await Promise.all([get().loadPrompts(), get().loadMemories(), get().loadStats()])
    get().noteActivity()
  }
}))
