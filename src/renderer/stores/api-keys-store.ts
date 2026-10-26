import { create } from 'zustand'
import {
  API_KEY_PROVIDER_CLI,
  API_KEY_PROVIDER_LABELS,
  type ApiKeyAddRequest,
  type ApiKeyRecord,
  type ApiKeyResult
} from '@shared/contracts/api-keys'
import { AI_ACCOUNTS_REFRESH_EVENT } from '@renderer/lib/app-events'
import { useAiAccountsStore } from './ai-accounts-store'
import { useSecretaryStore } from './secretary-store'

interface ApiKeysStore {
  keys: ApiKeyRecord[]
  loaded: boolean
  error: string | null
  testingIds: Record<string, boolean>
  testErrors: Record<string, string | undefined>
  load: () => Promise<void>
  add: (request: ApiKeyAddRequest) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  rename: (id: string, label: string) => Promise<boolean>
  setManager: (id: string | null) => Promise<boolean>
  test: (id: string) => Promise<void>
  /** Creates a CLI account that signs in with this key. Returns the new account id. */
  connectCli: (id: string) => Promise<string | null>
  clearError: () => void
}

export const useApiKeysStore = create<ApiKeysStore>((set, get) => {
  const apply = (result: ApiKeyResult): boolean => {
    set({ keys: result.keys, error: result.ok ? null : result.error ?? 'Could not update API keys' })
    return result.ok
  }
  const run = async (action: () => Promise<ApiKeyResult>): Promise<boolean> => {
    try {
      return apply(await action())
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not update API keys' })
      return false
    }
  }

  return {
    keys: [],
    loaded: false,
    error: null,
    testingIds: {},
    testErrors: {},
    load: async () => {
      try {
        set({ keys: await window.api.apiKeys.list(), loaded: true })
      } catch (error) {
        set({ loaded: true, error: error instanceof Error ? error.message : 'Could not load API keys' })
      }
    },
    add: async (request) => {
      const ok = await run(() => window.api.apiKeys.add(request))
      if (ok && request.useForManager) void useSecretaryStore.getState().load()
      return ok
    },
    remove: async (id) => {
      const ok = await run(() => window.api.apiKeys.remove(id))
      if (!ok) return false
      // Accounts that signed in with this key can no longer start.
      const accounts = useAiAccountsStore.getState()
      for (const account of accounts.accounts.filter((item) => item.apiKeyId === id)) {
        accounts.markAccountLoggedOut(account.id)
      }
      void useSecretaryStore.getState().load()
      return true
    },
    rename: (id, label) => run(() => window.api.apiKeys.rename(id, label)),
    setManager: async (id) => {
      const ok = await run(() => window.api.apiKeys.setManager(id))
      if (ok) void useSecretaryStore.getState().load()
      return ok
    },
    test: async (id) => {
      set((state) => ({ testingIds: { ...state.testingIds, [id]: true }, testErrors: { ...state.testErrors, [id]: undefined } }))
      try {
        const result = await window.api.apiKeys.test(id)
        set((state) => ({ testErrors: { ...state.testErrors, [id]: result.ok ? undefined : result.error } }))
      } finally {
        set((state) => ({ testingIds: { ...state.testingIds, [id]: false } }))
        await get().load()
      }
    },
    connectCli: async (id) => {
      const key = get().keys.find((item) => item.id === id)
      if (!key) return null
      const kind = API_KEY_PROVIDER_CLI[key.provider]
      const accounts = useAiAccountsStore.getState()
      const accountId = accounts.addAccount({
        kind,
        name: key.label,
        email: '',
        plan: `${API_KEY_PROVIDER_LABELS[key.provider]} API key`,
        note: ''
      })
      try {
        const result = await window.api.apiKeys.connectCli({ keyId: id, accountId })
        if (!result.ok || !result.ready) throw new Error(result.error || 'Could not connect this key')
        accounts.setAccountApiKey(accountId, id)
        accounts.markAccountAuthenticated(accountId, result.identity)
        accounts.setActiveAccount(kind, accountId)
        window.dispatchEvent(new Event(AI_ACCOUNTS_REFRESH_EVENT))
        return accountId
      } catch (error) {
        accounts.removeAccount(accountId, { suppressSystemImport: false })
        set({ error: error instanceof Error ? error.message : 'Could not connect this key' })
        return null
      }
    },
    clearError: () => set({ error: null })
  }
})
