import { create } from 'zustand'
import type { SecretarySettings } from '@shared/contracts/secretary'

const EMPTY_SETTINGS: SecretarySettings = {
  configured: false,
  model: 'gpt-5',
  usage: {
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    lastRequestAt: null
  }
}

interface SecretaryStore {
  settings: SecretarySettings
  loaded: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
  saveKey: (key: string) => Promise<boolean>
  clearKey: () => Promise<boolean>
  updateModel: (model: string) => Promise<boolean>
  resetUsage: () => Promise<boolean>
}

function messageFor(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

export const useSecretaryStore = create<SecretaryStore>((set) => ({
  settings: EMPTY_SETTINGS,
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const settings = await window.api.secretary.getSettings()
      set({ settings, loaded: true, loading: false })
    } catch (cause) {
      set({ loaded: true, loading: false, error: messageFor(cause, 'Could not load Secretary settings') })
    }
  },

  saveKey: async (key) => {
    set({ loading: true, error: null })
    try {
      const settings = await window.api.secretary.saveKey(key)
      set({ settings, loaded: true, loading: false })
      return true
    } catch (cause) {
      set({ loading: false, error: messageFor(cause, 'Could not save API key') })
      return false
    }
  },

  clearKey: async () => {
    set({ loading: true, error: null })
    try {
      const settings = await window.api.secretary.clearKey()
      set({ settings, loaded: true, loading: false })
      return true
    } catch (cause) {
      set({ loading: false, error: messageFor(cause, 'Could not remove API key') })
      return false
    }
  },

  updateModel: async (model) => {
    set({ loading: true, error: null })
    try {
      const settings = await window.api.secretary.updateSettings({ model })
      set({ settings, loaded: true, loading: false })
      return true
    } catch (cause) {
      set({ loading: false, error: messageFor(cause, 'Could not update the model') })
      return false
    }
  },

  resetUsage: async () => {
    set({ loading: true, error: null })
    try {
      const settings = await window.api.secretary.resetUsage()
      set({ settings, loaded: true, loading: false })
      return true
    } catch (cause) {
      set({ loading: false, error: messageFor(cause, 'Could not reset usage') })
      return false
    }
  }
}))
