import { create } from 'zustand'
import type { CliUsageInfo, CliUsageResponse } from '@shared/contracts/usage'
import {
  createEmptyUsageSnapshot,
  type PersistedUsageSnapshot
} from '@shared/contracts/persistence'

interface UsageStore extends PersistedUsageSnapshot {
  hydrate: (snapshot: Partial<PersistedUsageSnapshot> | undefined) => void
  getSnapshot: () => PersistedUsageSnapshot
  applyResponse: (response: CliUsageResponse, accountIds: string[]) => void
  markChecked: (accountIds: string[], checkedAt?: number) => void
  removeAccount: (accountId: string) => void
}

function providersByAccountId(providers: CliUsageInfo[]): Record<string, CliUsageInfo> {
  const map: Record<string, CliUsageInfo> = {}
  for (const provider of providers) {
    if (provider.accountId) map[provider.accountId] = provider
  }
  return map
}

function keepLastGoodUsage(
  previous: CliUsageInfo | undefined,
  next: CliUsageInfo | undefined
): CliUsageInfo | undefined {
  if (!next) return previous
  if (next.status === 'available' && (next.primary || next.secondary)) return next
  if (previous?.status === 'available' && (previous.primary || previous.secondary)) {
    return previous
  }
  return next
}

export const useUsageStore = create<UsageStore>((set, get) => ({
  ...createEmptyUsageSnapshot(),

  hydrate: (snapshot) => {
    const next = snapshot ?? createEmptyUsageSnapshot()
    set({
      providers: Array.isArray(next.providers) ? next.providers : [],
      checkedAtByAccountId:
        next.checkedAtByAccountId && typeof next.checkedAtByAccountId === 'object'
          ? { ...next.checkedAtByAccountId }
          : {}
    })
  },

  getSnapshot: () => {
    const { providers, checkedAtByAccountId } = get()
    return { providers, checkedAtByAccountId }
  },

  applyResponse: (response, accountIds) => {
    const checkedAt = response.checkedAt || Date.now()
    const incoming = providersByAccountId(response.providers)

    set((state) => {
      const currentById = providersByAccountId(state.providers)
      const checkedAtByAccountId = { ...state.checkedAtByAccountId }

      for (const accountId of accountIds) {
        const merged = keepLastGoodUsage(currentById[accountId], incoming[accountId])
        if (merged) currentById[accountId] = merged
        checkedAtByAccountId[accountId] = checkedAt
      }

      return {
        providers: Object.values(currentById),
        checkedAtByAccountId
      }
    })
  },

  markChecked: (accountIds, checkedAt = Date.now()) => {
    if (accountIds.length === 0) return
    set((state) => {
      const checkedAtByAccountId = { ...state.checkedAtByAccountId }
      for (const accountId of accountIds) {
        checkedAtByAccountId[accountId] = checkedAt
      }
      return { checkedAtByAccountId }
    })
  },

  removeAccount: (accountId) => {
    set((state) => {
      const { [accountId]: _removed, ...checkedAtByAccountId } = state.checkedAtByAccountId
      return {
        providers: state.providers.filter((provider) => provider.accountId !== accountId),
        checkedAtByAccountId
      }
    })
  }
}))
