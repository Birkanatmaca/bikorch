import { create } from 'zustand'
import type {
  AutomationDefinition,
  AutomationDraft,
  AutomationRun,
  AutomationSettings,
  AutomationStatusSummary
} from '@shared/contracts/automation'
import { createDefaultAutomationSettings } from '@shared/contracts/automation'

const IDLE_STATUS: AutomationStatusSummary = {
  running: 0,
  enabled: 0,
  waitingNetwork: 0,
  needsAttention: 0,
  nextRunAt: null
}

interface AutomationStore {
  definitions: AutomationDefinition[]
  runsByAutomation: Record<string, AutomationRun[]>
  settings: AutomationSettings
  status: AutomationStatusSummary
  loaded: boolean
  subscribed: boolean

  load: () => Promise<void>
  subscribe: () => void
  create: (draft: AutomationDraft) => Promise<AutomationDefinition | null>
  update: (id: string, patch: Partial<AutomationDraft>) => Promise<AutomationDefinition | null>
  remove: (id: string) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  runNow: (id: string) => Promise<void>
  loadRuns: (automationId: string) => Promise<void>
  updateSettings: (patch: Partial<AutomationSettings>) => Promise<void>
}

export const useAutomationStore = create<AutomationStore>((set, get) => ({
  definitions: [],
  runsByAutomation: {},
  settings: createDefaultAutomationSettings(),
  status: IDLE_STATUS,
  loaded: false,
  subscribed: false,

  load: async () => {
    const api = window.api?.automation
    if (!api) return
    try {
      const [definitions, settings, status] = await Promise.all([
        api.list(),
        api.getSettings(),
        api.getStatus()
      ])
      set({ definitions, settings, status, loaded: true })
    } catch (error) {
      console.error('Failed to load automations:', error)
      set({ loaded: true })
    }
  },

  subscribe: () => {
    if (get().subscribed) return
    const api = window.api?.automation
    if (!api) return
    set({ subscribed: true })

    api.onEvent((event) => {
      if (event.type === 'definition-changed') {
        set((state) => {
          const exists = state.definitions.some((d) => d.id === event.definition.id)
          return {
            definitions: exists
              ? state.definitions.map((d) => (d.id === event.definition.id ? event.definition : d))
              : [event.definition, ...state.definitions]
          }
        })
      } else if (event.type === 'definition-removed') {
        set((state) => ({
          definitions: state.definitions.filter((d) => d.id !== event.automationId)
        }))
      } else if (event.type === 'run-changed') {
        set((state) => {
          const existing = state.runsByAutomation[event.run.automationId] ?? []
          const next = existing.some((r) => r.id === event.run.id)
            ? existing.map((r) => (r.id === event.run.id ? event.run : r))
            : [event.run, ...existing]
          return {
            runsByAutomation: { ...state.runsByAutomation, [event.run.automationId]: next }
          }
        })
      } else if (event.type === 'status-changed') {
        set({ status: event.status })
      }
    })
  },

  create: async (draft) => {
    const api = window.api?.automation
    if (!api) return null
    const definition = await api.create(draft)
    set((state) => ({ definitions: [definition, ...state.definitions] }))
    return definition
  },

  update: async (id, patch) => {
    const api = window.api?.automation
    if (!api) return null
    const definition = await api.update(id, patch)
    set((state) => ({
      definitions: state.definitions.map((d) => (d.id === id ? definition : d))
    }))
    return definition
  },

  remove: async (id) => {
    const api = window.api?.automation
    if (!api) return
    await api.remove(id)
    set((state) => ({ definitions: state.definitions.filter((d) => d.id !== id) }))
  },

  setEnabled: async (id, enabled) => {
    const api = window.api?.automation
    if (!api) return
    const definition = await api.setEnabled(id, enabled)
    set((state) => ({
      definitions: state.definitions.map((d) => (d.id === id ? definition : d))
    }))
  },

  runNow: async (id) => {
    const api = window.api?.automation
    if (!api) return
    await api.runNow(id)
    void get().loadRuns(id)
  },

  loadRuns: async (automationId) => {
    const api = window.api?.automation
    if (!api) return
    const runs = await api.listRuns(automationId)
    set((state) => ({ runsByAutomation: { ...state.runsByAutomation, [automationId]: runs } }))
  },

  updateSettings: async (patch) => {
    const api = window.api?.automation
    if (!api) return
    const settings = await api.updateSettings(patch)
    set({ settings })
  }
}))
