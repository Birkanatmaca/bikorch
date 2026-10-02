import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { completeCliSignIn, recoverCompletedCliSignIn } from '../cli-login-lifecycle'

const inspect = vi.fn()
let accountId: string
let panelId: string
let projectId: string
beforeEach(() => {
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), api: { authProfiles: { inspect } } })
  inspect.mockReset().mockResolvedValue({ ok: true, ready: true, identity: { email: 'saved@example.com' } })
  useAiAccountsStore.getState().hydrate({ accounts: [] })
  useWorkspaceStore.setState({ projects: [], activeProjectId: null, workspaces: {} })
  projectId = useWorkspaceStore.getState().addProject('Test', '/project')
  accountId = useAiAccountsStore.getState().addAccount({ kind: 'codex', name: 'New Codex account', email: '', plan: '', note: '' })
  panelId = useWorkspaceStore.getState().addPanel('codex', 'center', undefined, 'login', accountId)
})
afterEach(() => vi.unstubAllGlobals())

describe('login continuity', () => {
  it('persists a started login across workspace rehydration without promoting it to normal', () => {
    useWorkspaceStore.getState().markPanelLoginStarted(panelId)
    const snapshot = useWorkspaceStore.getState().getSnapshot()
    useWorkspaceStore.getState().hydrate(snapshot)
    expect(useWorkspaceStore.getState().workspaces[projectId].panels.find((panel) => panel.id === panelId)).toMatchObject({ launchMode: 'login', loginStarted: true })
  })
  it('completes the owning panel when a different project is active', () => {
    useWorkspaceStore.getState().markPanelLoginStarted(panelId)
    useWorkspaceStore.getState().addProject('Other', '/other')
    expect(completeCliSignIn(panelId, 'codex', accountId, { email: 'saved@example.com', name: 'Saved account' })).toBe(true)
    const panel = useWorkspaceStore.getState().workspaces[projectId].panels.find((item) => item.id === panelId)
    expect(panel?.launchMode).toBeUndefined()
    expect(panel?.loginStarted).toBeUndefined()
    expect(useAiAccountsStore.getState().activeAccountByKind.codex).toBe(accountId)
  })
  it('recovers completed credentials before restarting a login process', async () => {
    expect(await recoverCompletedCliSignIn(panelId, 'codex', accountId, () => true)).toBe(true)
    expect(useAiAccountsStore.getState().accounts[0]).toMatchObject({ profileReady: true, email: 'saved@example.com' })
  })
  it('does not promote an unfinished or unmounted login', async () => {
    inspect.mockResolvedValueOnce({ ok: true, ready: false })
    expect(await recoverCompletedCliSignIn(panelId, 'codex', accountId, () => true)).toBe(false)
    expect(await recoverCompletedCliSignIn(panelId, 'codex', accountId, () => false)).toBe(false)
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.panels.find((panel) => panel.id === panelId)?.launchMode).toBe('login')
  })
  it('does not resurrect a deleted account from a delayed auth check', async () => {
    useAiAccountsStore.getState().removeAccount(accountId)
    expect(await recoverCompletedCliSignIn(panelId, 'codex', accountId, () => true)).toBe(false)
    expect(useAiAccountsStore.getState().accounts).toHaveLength(0)
  })
  it('ignores a stale profile listing after successful login or deletion', () => {
    const observedAt = Date.now() - 1
    completeCliSignIn(panelId, 'codex', accountId)
    useAiAccountsStore.getState().syncAuthProfiles([], observedAt)
    expect(useAiAccountsStore.getState().accounts[0].profileReady).toBe(true)
    useAiAccountsStore.getState().removeAccount(accountId)
    useAiAccountsStore.getState().syncAuthProfiles([{ kind: 'codex', accountId, ready: true, name: 'Stale', email: '' }], observedAt)
    expect(useAiAccountsStore.getState().accounts).toHaveLength(0)
  })
})
