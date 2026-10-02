import type { CliUsageKind } from '@shared/contracts/usage'
import type { AuthProfileIdentity } from '@shared/contracts/auth-profiles'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { AI_ACCOUNT_AUTHENTICATED_EVENT, AI_ACCOUNTS_REFRESH_EVENT } from './app-events'

export function completeCliSignIn(sessionId: string, kind: CliUsageKind, accountId: string, identity?: AuthProfileIdentity): boolean {
  const account = useAiAccountsStore.getState().accounts.find((item) => item.id === accountId && item.kind === kind)
  const panel = Object.values(useWorkspaceStore.getState().workspaces).flatMap((workspace) => workspace.panels)
    .find((item) => item.id === sessionId && item.accountId === accountId && item.type === kind)
  if (!account || !panel) return false
  useAiAccountsStore.getState().markAccountAuthenticated(accountId, identity)
  useAiAccountsStore.getState().setActiveAccount(kind, accountId)
  useWorkspaceStore.getState().clearPanelLaunchMode(sessionId)
  window.dispatchEvent(new CustomEvent(AI_ACCOUNT_AUTHENTICATED_EVENT, { detail: { accountId, kind, identity } }))
  window.dispatchEvent(new Event(AI_ACCOUNTS_REFRESH_EVENT))
  return true
}

export async function recoverCompletedCliSignIn(sessionId: string, kind: CliUsageKind, accountId: string, isActive: () => boolean): Promise<boolean> {
  const result = await window.api.authProfiles.inspect({ kind, accountId })
  return isActive() && result.ok && result.ready && completeCliSignIn(sessionId, kind, accountId, result.identity)
}
