import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { openCliSignIn, openInstalledCli, openSavedCliAccount } from '../cli-sign-in'

vi.mock('../usage-sync', () => ({ invalidateAccountUsage: vi.fn() }))
const detect = vi.fn()
const activate = vi.fn()
beforeEach(() => {
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), api: { cli: { detect }, authProfiles: { activate } } })
  activate.mockReset().mockResolvedValue({ ok: true, ready: true })
  detect.mockReset().mockResolvedValue({ installed: true, command: 'agent' })
  useAiAccountsStore.getState().hydrate({ accounts: [] })
  useWorkspaceStore.setState({ projects: [], activeProjectId: null, workspaces: {} })
  useWorkspaceStore.getState().addProject('Test project', '/project')
})
afterEach(() => vi.unstubAllGlobals())

describe('CLI account setup', () => {
  it('does not create an account or login panel for a missing CLI', async () => {
    detect.mockResolvedValue({ installed: false, command: null })
    await expect(openCliSignIn('cursor')).rejects.toThrow('not installed')
    expect(useAiAccountsStore.getState().accounts).toHaveLength(0)
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.panels.filter((panel) => panel.type === 'cursor')).toHaveLength(0)
  })

  it('opens a managed login and resumes it without duplicating accounts', async () => {
    await openInstalledCli('cursor')
    const [account] = useAiAccountsStore.getState().accounts
    expect(account.profileReady).toBe(false)
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.panels.find((panel) => panel.type === 'cursor')).toMatchObject({
      type: 'cursor', launchMode: 'login', accountId: account.id
    })
    await openInstalledCli('cursor')
    expect(useAiAccountsStore.getState().accounts).toHaveLength(1)
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.panels.filter((panel) => panel.type === 'cursor')).toHaveLength(1)
  })

  it('opens an authenticated account in normal mode', async () => {
    await openCliSignIn('codex')
    const [account] = useAiAccountsStore.getState().accounts
    useAiAccountsStore.getState().markAccountAuthenticated(account.id, { email: 'user@example.com' })
    useWorkspaceStore.getState().removePanelsForAccount('codex', account.id)
    await openInstalledCli('codex')
    const panel = useWorkspaceStore.getState().getActiveWorkspace()?.panels.find((panel) => panel.type === 'codex')
    expect(panel).toMatchObject({ type: 'codex', accountId: account.id })
    expect(panel?.launchMode).toBeUndefined()
    expect(useAiAccountsStore.getState().accounts).toHaveLength(1)
  })

  it('deduplicates clicks across launch surfaces while checking the CLI', async () => {
    let finish!: (result: object) => void
    detect.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const first = openInstalledCli('cursor')
    const second = openCliSignIn('cursor')
    finish({ installed: true, command: 'agent' })
    await Promise.all([first, second])
    expect(detect).toHaveBeenCalledOnce()
    expect(useAiAccountsStore.getState().accounts).toHaveLength(1)
  })

  it('returns to an existing pending login in another project without replacing it', async () => {
    await openInstalledCli('codex')
    const owner = useWorkspaceStore.getState().activeProjectId
    const panel = useWorkspaceStore.getState().getActiveWorkspace()?.panels.find((item) => item.type === 'codex')
    useWorkspaceStore.getState().markPanelLoginStarted(panel!.id)
    useWorkspaceStore.getState().addProject('Other project', '/other')
    await openInstalledCli('codex')
    expect(useWorkspaceStore.getState().activeProjectId).toBe(owner)
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.panels.find((item) => item.type === 'codex')).toMatchObject({ id: panel!.id, loginStarted: true })
    expect(useAiAccountsStore.getState().accounts).toHaveLength(1)
  })

  it('does not create an account in a project selected during detection', async () => {
    let finish!: (result: object) => void
    detect.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const opening = openInstalledCli('gemini')
    useWorkspaceStore.getState().addProject('Other project', '/other')
    finish({ installed: true, command: 'gemini' })
    await expect(opening).rejects.toThrow('project changed')
    expect(useAiAccountsStore.getState().accounts).toHaveLength(0)
  })

  it('does not reopen an account removed during detection', async () => {
    await openCliSignIn('claude')
    const [account] = useAiAccountsStore.getState().accounts
    let finish!: (result: object) => void
    detect.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const opening = openCliSignIn('claude', account)
    useAiAccountsStore.getState().removeAccount(account.id)
    finish({ installed: true, command: 'claude' })
    await expect(opening).rejects.toThrow('removed')
    expect(useAiAccountsStore.getState().accounts).toHaveLength(0)
  })

  it('does not open a saved account in a project selected during activation', async () => {
    const id = useAiAccountsStore.getState().addAccount({ kind: 'codex', name: 'Saved', email: '', note: '', plan: '' })
    useAiAccountsStore.getState().markAccountAuthenticated(id)
    const account = useAiAccountsStore.getState().accounts[0]
    let finish!: (result: object) => void
    activate.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const opening = openSavedCliAccount(account)
    await vi.waitFor(() => expect(activate).toHaveBeenCalledOnce())
    useWorkspaceStore.getState().addProject('Other', '/other')
    finish({ ok: true, ready: true })
    await expect(opening).rejects.toThrow('project changed')
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.panels.some((panel) => panel.type === 'codex')).toBe(false)
  })

  it('does not reopen an account removed while its activation was pending', async () => {
    const id = useAiAccountsStore.getState().addAccount({ kind: 'codex', name: 'Saved', email: '', note: '', plan: '' })
    useAiAccountsStore.getState().markAccountAuthenticated(id)
    let finish!: (result: object) => void
    activate.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const opening = openSavedCliAccount(useAiAccountsStore.getState().accounts[0])
    await vi.waitFor(() => expect(activate).toHaveBeenCalledOnce())
    useAiAccountsStore.getState().removeAccount(id)
    finish({ ok: true, ready: true })
    await expect(opening).rejects.toThrow('removed')
  })

  it('returns an expired saved account to sign-in without creating another card', async () => {
    const id = useAiAccountsStore.getState().addAccount({ kind: 'codex', name: 'Saved', email: '', note: '', plan: '' })
    useAiAccountsStore.getState().markAccountAuthenticated(id)
    activate.mockResolvedValue({ ok: true, ready: false })
    await openSavedCliAccount(useAiAccountsStore.getState().accounts[0])
    expect(useAiAccountsStore.getState().accounts).toHaveLength(1)
    expect(useWorkspaceStore.getState().getActiveWorkspace()?.panels.find((panel) => panel.type === 'codex')).toMatchObject({ accountId: id, launchMode: 'login' })
  })
})
