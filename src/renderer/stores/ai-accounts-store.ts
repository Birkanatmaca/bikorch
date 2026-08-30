import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import {
  createDefaultActiveAccountByKind,
  type AiAccount,
  type ActiveAccountByKind,
  type AiAccountsSnapshot,
  type DiscoveredAiAccount
} from '@shared/contracts/accounts'
import type { CliUsageKind } from '@shared/contracts/usage'

export type AiAccountDraft = Pick<AiAccount, 'kind' | 'name' | 'email' | 'plan' | 'note'>

interface AiAccountsStore extends AiAccountsSnapshot {
  hydrate: (snapshot: Partial<AiAccountsSnapshot>) => void
  getSnapshot: () => AiAccountsSnapshot
  addAccount: (draft: AiAccountDraft) => string
  updateAccount: (accountId: string, updates: Partial<AiAccountDraft>) => void
  removeAccount: (accountId: string) => void
  setActiveAccount: (kind: CliUsageKind, accountId: string) => void
  markAccountAuthenticated: (
    accountId: string,
    identity?: { email?: string; name?: string }
  ) => void
  syncDiscoveredAccounts: (discovered: DiscoveredAiAccount[]) => void
}

function initialState(): AiAccountsSnapshot {
  return {
    accounts: [],
    activeAccountByKind: createDefaultActiveAccountByKind()
  }
}

export const useAiAccountsStore = create<AiAccountsStore>((set, get) => ({
  ...initialState(),

  hydrate: (snapshot) => {
    const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : []
    const activeAccountByKind = {
      ...createDefaultActiveAccountByKind(),
      ...(snapshot.activeAccountByKind ?? {})
    }
    set({ accounts, activeAccountByKind })
  },

  getSnapshot: () => {
    const { accounts, activeAccountByKind } = get()
    return { accounts, activeAccountByKind }
  },

  addAccount: (draft) => {
    const account: AiAccount = {
      id: uuidv4(),
      kind: draft.kind,
      name: draft.name.trim() || 'AI account',
      email: draft.email.trim(),
      plan: draft.plan.trim(),
      note: draft.note.trim(),
      createdAt: Date.now(),
      source: 'manual',
      lastSeenAt: null,
      profileReady: false,
      lastAuthenticatedAt: null
    }
    const current = get()
    const activeAccountByKind = { ...current.activeAccountByKind }
    if (!activeAccountByKind[account.kind]) {
      activeAccountByKind[account.kind] = account.id
    }
    set({
      accounts: [...current.accounts, account],
      activeAccountByKind
    })
    return account.id
  },

  updateAccount: (accountId, updates) => {
    set((state) => ({
      accounts: state.accounts.map((account) =>
        account.id === accountId
          ? {
              ...account,
              ...updates,
              name: updates.name === undefined ? account.name : updates.name.trim(),
              email: updates.email === undefined ? account.email : updates.email.trim(),
              plan: updates.plan === undefined ? account.plan : updates.plan.trim(),
              note: updates.note === undefined ? account.note : updates.note.trim()
            }
          : account
      )
    }))
  },

  removeAccount: (accountId) => {
    const current = get()
    const removed = current.accounts.find((account) => account.id === accountId)
    if (!removed) return

    const accounts = current.accounts.filter((account) => account.id !== accountId)
    const activeAccountByKind = { ...current.activeAccountByKind }
    if (activeAccountByKind[removed.kind] === accountId) {
      activeAccountByKind[removed.kind] =
        accounts.find((account) => account.kind === removed.kind)?.id ?? null
    }
    set({ accounts, activeAccountByKind })
  },

  setActiveAccount: (kind, accountId) => {
    const account = get().accounts.find(
      (candidate) => candidate.id === accountId && candidate.kind === kind
    )
    if (!account) return
    set((state) => ({
      activeAccountByKind: {
        ...state.activeAccountByKind,
        [kind]: account.id
      }
    }))
  },

  markAccountAuthenticated: (accountId, identity) => {
    const now = Date.now()
    set((state) => ({
      accounts: state.accounts.map((account) =>
        account.id === accountId
          ? {
              ...account,
              email: identity?.email?.trim() || account.email,
              name:
                account.source === 'discovered' || /^New .+ account$/i.test(account.name)
                  ? identity?.name?.trim() || identity?.email?.trim() || account.name
                  : account.name,
              profileReady: true,
              lastSeenAt: now,
              lastAuthenticatedAt: now
            }
          : account
      )
    }))
  },

  syncDiscoveredAccounts: (discovered) => {
    const now = Date.now()
    const current = get()
    const accounts = [...current.accounts]
    const activeAccountByKind = { ...current.activeAccountByKind }

    for (const incoming of discovered) {
      const normalizedEmail = incoming.email.trim().toLowerCase()
      const existingIndex = accounts.findIndex(
        (account) =>
          account.kind === incoming.kind &&
          ((normalizedEmail && account.email.trim().toLowerCase() === normalizedEmail) ||
            (account.source === 'discovered' && account.name === incoming.name))
      )

      if (existingIndex >= 0) {
        const existing = accounts[existingIndex]
        accounts[existingIndex] = {
          ...existing,
          name: existing.source === 'manual' ? existing.name : incoming.name,
          email: incoming.email || existing.email,
          plan: incoming.plan || existing.plan,
          source: existing.source,
          lastSeenAt: now
        }
        if (!activeAccountByKind[incoming.kind]) {
          activeAccountByKind[incoming.kind] = existing.id
        }
        continue
      }

      const account: AiAccount = {
        id: `discovered:${incoming.kind}:${normalizedEmail || incoming.name.toLowerCase()}`,
        kind: incoming.kind,
        name: incoming.name,
        email: incoming.email,
        plan: incoming.plan,
        note: '',
        createdAt: now,
        source: 'discovered',
        lastSeenAt: now,
        profileReady: false,
        lastAuthenticatedAt: null
      }
      accounts.push(account)
      if (!activeAccountByKind[incoming.kind]) {
        activeAccountByKind[incoming.kind] = account.id
      }
    }

    set({ accounts, activeAccountByKind })
  }
}))
