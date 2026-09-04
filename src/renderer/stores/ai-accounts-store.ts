import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import {
  createDefaultActiveAccountByKind,
  type AiAccount,
  type ActiveAccountByKind,
  type AiAccountsSnapshot
} from '@shared/contracts/accounts'
import type { CliUsageKind } from '@shared/contracts/usage'
import type { AuthProfileSummary } from '@shared/contracts/auth-profiles'

export type AiAccountDraft = Pick<AiAccount, 'kind' | 'name' | 'email' | 'plan' | 'note'>

interface AiAccountsStore extends AiAccountsSnapshot {
  suppressSystemImportByKind: Record<CliUsageKind, boolean>
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
  syncAuthProfiles: (profiles: AuthProfileSummary[]) => void
}

function createDefaultSuppressSystemImport(): Record<CliUsageKind, boolean> {
  return {
    claude: false,
    cursor: false,
    gemini: false,
    antigravity: false,
    codex: false
  }
}

function initialState(): AiAccountsSnapshot & {
  suppressSystemImportByKind: Record<CliUsageKind, boolean>
} {
  return {
    accounts: [],
    activeAccountByKind: createDefaultActiveAccountByKind(),
    suppressSystemImportByKind: createDefaultSuppressSystemImport()
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
    set({
      accounts,
      activeAccountByKind,
      suppressSystemImportByKind: createDefaultSuppressSystemImport()
    })
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
    set({ accounts: [...current.accounts, account] })
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
      activeAccountByKind[removed.kind] = null
    }
    const hasRemainingReady = accounts.some(
      (account) => account.kind === removed.kind && account.profileReady
    )
    set({
      accounts,
      activeAccountByKind,
      suppressSystemImportByKind: {
        ...current.suppressSystemImportByKind,
        [removed.kind]: !hasRemainingReady
      }
    })
  },

  setActiveAccount: (kind, accountId) => {
    const account = get().accounts.find(
      (candidate) =>
        candidate.id === accountId && candidate.kind === kind && candidate.profileReady
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
    set((state) => {
      const accounts = state.accounts.map((account) =>
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
      const authenticated = accounts.find((account) => account.id === accountId)
      return {
        accounts,
        suppressSystemImportByKind: authenticated
          ? {
              ...state.suppressSystemImportByKind,
              [authenticated.kind]: false
            }
          : state.suppressSystemImportByKind
      }
    })
  },

  syncAuthProfiles: (profiles) => {
    const now = Date.now()
    const current = get()
    const profilesById = new Map(profiles.map((profile) => [profile.accountId, profile]))
    const accounts = current.accounts.map((account) => {
      const profile = profilesById.get(account.id)
      if (!profile || profile.kind !== account.kind) {
        return account.profileReady ? { ...account, profileReady: false } : account
      }

      profilesById.delete(account.id)
      return {
        ...account,
        name: account.source === 'manual' ? account.name : profile.name || account.name,
        email: profile.email || account.email,
        profileReady: profile.ready,
        lastSeenAt: now,
        lastAuthenticatedAt: account.lastAuthenticatedAt ?? (profile.ready ? now : null)
      }
    })
    const activeAccountByKind = { ...current.activeAccountByKind }

    for (const profile of profilesById.values()) {
      const account: AiAccount = {
        id: profile.accountId,
        kind: profile.kind,
        name: profile.name || `${profile.kind} account`,
        email: profile.email,
        plan: '',
        note: '',
        createdAt: now,
        source: 'discovered',
        lastSeenAt: now,
        profileReady: profile.ready,
        lastAuthenticatedAt: profile.ready ? now : null
      }
      accounts.push(account)
    }

    for (const kind of Object.keys(activeAccountByKind) as CliUsageKind[]) {
      const activeId = activeAccountByKind[kind]
      if (
        activeId &&
        !accounts.some(
          (account) => account.id === activeId && account.kind === kind && account.profileReady
        )
      ) {
        activeAccountByKind[kind] = null
      }
    }

    set({ accounts, activeAccountByKind })
  }
}))
