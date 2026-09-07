import { create } from 'zustand'
import type { CliUsageInfo, CliUsageResponse } from '@shared/contracts/usage'
import {
  createEmptyUsageSnapshot,
  type UsageSnapshotRecord,
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

const USAGE_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const MAX_USAGE_HISTORY_RECORDS = 5000

function toUsageSnapshotRecord(
  provider: CliUsageInfo,
  checkedAt: number
): UsageSnapshotRecord | null {
  if (!provider.accountId) return null
  return {
    checkedAt,
    accountId: provider.accountId,
    kind: provider.kind,
    status: provider.status,
    ...(provider.primary ? {
      primaryUsedPercent: provider.primary.usedPercent,
      primaryResetsAt: provider.primary.resetsAt
    } : {}),
    ...(provider.secondary ? {
      secondaryUsedPercent: provider.secondary.usedPercent,
      secondaryResetsAt: provider.secondary.resetsAt
    } : {}),
    ...(provider.planType !== undefined ? { planType: provider.planType } : {}),
    ...(provider.credits ? {
      creditsBalance: provider.credits.balance,
      creditsAvailable: provider.credits.hasCredits || provider.credits.unlimited
    } : {})
  }
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
          : {},
      history: Array.isArray(next.history) ? next.history : []
    })
  },

  getSnapshot: () => {
    const { providers, checkedAtByAccountId, history } = get()
    return { providers, checkedAtByAccountId, history }
  },

  applyResponse: (response, accountIds) => {
    const incoming = providersByAccountId(response.providers)

    set((state) => {
      const currentById = providersByAccountId(state.providers)
      const checkedAtByAccountId = { ...state.checkedAtByAccountId }
      const checkedAt = response.checkedAt || Date.now()
      const historyByAccount = new Map(
        state.history.map((record) => [`${record.accountId}:${record.checkedAt}`, record])
      )

      for (const accountId of accountIds) {
        const merged = keepLastGoodUsage(currentById[accountId], incoming[accountId])
        if (merged) currentById[accountId] = merged
        checkedAtByAccountId[accountId] = checkedAt
        const sample = incoming[accountId]
          ? toUsageSnapshotRecord(incoming[accountId], checkedAt)
          : null
        if (sample) historyByAccount.set(`${sample.accountId}:${sample.checkedAt}`, sample)
      }

      const cutoff = Date.now() - USAGE_HISTORY_RETENTION_MS
      const history = [...historyByAccount.values()]
        .filter((record) => record.checkedAt >= cutoff)
        .sort((a, b) => a.checkedAt - b.checkedAt)
        .slice(-MAX_USAGE_HISTORY_RECORDS)

      return {
        providers: Object.values(currentById),
        checkedAtByAccountId,
        history
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
        checkedAtByAccountId,
        history: state.history.filter((record) => record.accountId !== accountId)
      }
    })
  }
}))
