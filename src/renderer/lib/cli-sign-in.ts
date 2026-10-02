import { AI_ACCOUNT_LABELS, type AiAccount } from '@shared/contracts/accounts'
import type { CliUsageKind } from '@shared/contracts/usage'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useUsageStore } from '@renderer/stores/usage-store'
import { useCliStore } from '@renderer/stores/cli-store'
import { invalidateAccountUsage } from './usage-sync'
import { FOCUS_TERMINAL_EVENT } from './app-events'
import { useTerminalStore } from '@renderer/stores/terminal-store'

const launches = new Map<string, Promise<void>>()

function assertCurrentProject(projectId: string): void {
  if (useWorkspaceStore.getState().activeProjectId !== projectId || !useWorkspaceStore.getState().workspaces[projectId]) {
    throw new Error('The project changed while checking the CLI. Open the agent again in your project.')
  }
}

function withInstalledCli(kind: CliUsageKind, action: (projectId: string) => void | Promise<void>): Promise<void> {
  const projectId = useWorkspaceStore.getState().activeProjectId
  if (!projectId || !useWorkspaceStore.getState().getActiveWorkspace()) return Promise.reject(new Error('Open a project before signing in'))
  const key = `${projectId}:${kind}`
  const existing = launches.get(key)
  if (existing) return existing
  const promise = (async () => {
    if (!await useCliStore.getState().detect(kind)) throw new Error(useCliStore.getState().errorsByKind[kind] || `${AI_ACCOUNT_LABELS[kind]} is not installed on this computer`)
    assertCurrentProject(projectId)
    await action(projectId)
  })().finally(() => launches.delete(key))
  launches.set(key, promise)
  return promise
}

function openSignInPanel(kind: CliUsageKind, account?: AiAccount): void {
  const workspace = useWorkspaceStore.getState()
  const accounts = useAiAccountsStore.getState()
  if (account && !accounts.accounts.some((item) => item.id === account.id && item.kind === kind)) throw new Error('This account was removed. Add an account again.')
  if (account) {
    for (const [projectId, saved] of Object.entries(workspace.workspaces)) {
      const pendingPanel = saved.panels.find((panel) => panel.type === kind && panel.accountId === account.id && panel.launchMode === 'login')
      if (!pendingPanel) continue
      if (workspace.activeProjectId !== projectId) workspace.setActiveProject(projectId)
      window.dispatchEvent(new CustomEvent(FOCUS_TERMINAL_EVENT, { detail: pendingPanel.id }))
      return
    }
  }
  const accountId = account?.id ?? accounts.addAccount({
    kind, name: `New ${AI_ACCOUNT_LABELS[kind]} account`, email: '', plan: '', note: ''
  })
  invalidateAccountUsage(accountId)
  accounts.markAccountLoggedOut(accountId)
  useUsageStore.getState().removeAccount(accountId)
  if (kind === 'antigravity') workspace.closeOtherAccountCliPanels(kind, accountId)
  else workspace.removePanelsForAccount(kind, accountId)
  workspace.addPanel(kind, 'center', undefined, 'login', accountId, `${AI_ACCOUNT_LABELS[kind]} · Sign in`)
}

export function openCliSignIn(kind: CliUsageKind, account?: AiAccount): Promise<void> {
  return withInstalledCli(kind, () => openSignInPanel(kind, account))
}

export function openInstalledCli(kind: CliUsageKind): Promise<void> {
  return withInstalledCli(kind, () => {
    const accounts = useAiAccountsStore.getState().accounts
    if (accounts.some((account) => account.kind === kind && account.profileReady)) {
      useWorkspaceStore.getState().addPanel(kind, 'center')
    } else {
      openSignInPanel(kind, accounts.find((account) => account.kind === kind && !account.profileReady))
    }
  })
}

export function openSavedCliAccount(account: AiAccount): Promise<void> {
  return withInstalledCli(account.kind, async (projectId) => {
    const current = useAiAccountsStore.getState().accounts.find((item) => item.id === account.id && item.kind === account.kind)
    if (!current) throw new Error('This account was removed. Add an account again.')
    if (!current.profileReady) { openSignInPanel(account.kind, current); return }
    const result = await window.api.authProfiles.activate({ kind: current.kind, accountId: current.id, ...(current.email ? { email: current.email } : {}) })
    assertCurrentProject(projectId)
    const latest = useAiAccountsStore.getState().accounts.find((item) => item.id === account.id && item.kind === account.kind)
    if (!latest) throw new Error('This account was removed. Add an account again.')
    if (!result.ok) throw new Error(result.error || `Could not activate ${latest.name}`)
    if (!result.ready || !latest.profileReady) { openSignInPanel(account.kind, latest); return }
    const workspace = useWorkspaceStore.getState()
    if (account.kind === 'antigravity') workspace.closeOtherAccountCliPanels(account.kind, account.id)
    useAiAccountsStore.getState().setActiveAccount(account.kind, account.id)
    if (account.kind === 'cursor') {
      const existing = workspace.getActiveWorkspace()?.panels.find((panel) => panel.type === 'cursor' && panel.accountId === account.id &&
        panel.launchMode !== 'login' && ['starting', 'running', 'waiting', 'busy'].includes(useTerminalStore.getState().getStatus(panel.id) ?? ''))
      if (existing) { window.dispatchEvent(new CustomEvent('bikorch:focus-panel', { detail: existing.id })); return }
    }
    workspace.addPanel(account.kind, 'center', undefined, 'normal', account.id, `${AI_ACCOUNT_LABELS[account.kind]} · ${latest.name}`)
  })
}
