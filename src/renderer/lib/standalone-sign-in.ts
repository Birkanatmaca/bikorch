import { create } from 'zustand'
import { AI_ACCOUNT_LABELS, type AiAccount } from '@shared/contracts/accounts'
import type { AuthProfileIdentity, AuthProfileResult } from '@shared/contracts/auth-profiles'
import type { CliUsageKind } from '@shared/contracts/usage'
export { SETUP_SIGN_IN_PROJECT_ID as SETUP_PROJECT_ID } from '@shared/contracts/pty'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useUsageStore } from '@renderer/stores/usage-store'
import { AI_ACCOUNT_AUTHENTICATED_EVENT, AI_ACCOUNTS_REFRESH_EVENT } from './app-events'
import { invalidateAccountUsage } from './usage-sync'

/**
 * Sign-in that does not need an open project: the CLI runs in the home folder
 * inside a setup dialog. Antigravity's login replaces the machine-wide session,
 * so it keeps using the workspace flow that handles that hand-off.
 */
export const STANDALONE_SIGN_IN_KINDS: readonly CliUsageKind[] = ['claude', 'codex', 'gemini', 'cursor']

export interface SetupSignIn {
  kind: CliUsageKind
  accountId: string
  sessionId: string
  /** True when this sign-in created the account card, so cancelling removes it again. */
  createdAccount: boolean
}

interface SetupSignInStore {
  active: SetupSignIn | null
  start: (kind: CliUsageKind, account?: AiAccount) => SetupSignIn
  finish: (identity?: AuthProfileIdentity) => void
  cancel: () => void
}

export const useSetupSignInStore = create<SetupSignInStore>((set, get) => ({
  active: null,
  start: (kind, account) => {
    const current = get().active
    if (current) return current
    const accounts = useAiAccountsStore.getState()
    const accountId =
      account?.id ??
      accounts.addAccount({ kind, name: `New ${AI_ACCOUNT_LABELS[kind]} account`, email: '', plan: '', note: '' })
    invalidateAccountUsage(accountId)
    accounts.markAccountLoggedOut(accountId)
    useUsageStore.getState().removeAccount(accountId)
    const active: SetupSignIn = {
      kind,
      accountId,
      sessionId: `setup-${kind}-${accountId}`,
      createdAccount: !account
    }
    set({ active })
    return active
  },
  finish: (identity) => {
    const active = get().active
    if (!active) return
    set({ active: null })
    void window.api.pty.kill({ sessionId: active.sessionId })
    useAiAccountsStore.getState().markAccountAuthenticated(active.accountId, identity)
    useAiAccountsStore.getState().setActiveAccount(active.kind, active.accountId)
    window.dispatchEvent(
      new CustomEvent(AI_ACCOUNT_AUTHENTICATED_EVENT, {
        detail: { accountId: active.accountId, kind: active.kind, identity }
      })
    )
    window.dispatchEvent(new Event(AI_ACCOUNTS_REFRESH_EVENT))
  },
  cancel: () => {
    const active = get().active
    if (!active) return
    set({ active: null })
    void window.api.pty.kill({ sessionId: active.sessionId })
    // Do not leave a "New … account" card behind for a sign-in that never finished.
    const account = useAiAccountsStore.getState().accounts.find((item) => item.id === active.accountId)
    if (active.createdAccount && account && !account.profileReady) {
      useAiAccountsStore.getState().removeAccount(active.accountId, { suppressSystemImport: false })
      void window.api.authProfiles.remove({ kind: active.kind, accountId: active.accountId }).catch(() => undefined)
    }
  }
}))

/** Checks whether the CLI finished signing in, the same way the workspace terminal does. */
export function inspectSignIn(kind: CliUsageKind, accountId: string): Promise<AuthProfileResult> {
  const request = { kind, accountId }
  return kind === 'cursor'
    ? window.api.authProfiles.importCurrent(request)
    : window.api.authProfiles.inspect(request)
}
