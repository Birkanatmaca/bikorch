import { afterEach, expect, it, vi } from 'vitest'
import type { AuthProfileSummary } from '@shared/contracts/auth-profiles'

const states = vi.hoisted(() => ({
  workspace: { hydrate: vi.fn(), activeProjectId: null },
  editor: { hydrate: vi.fn() },
  accounts: { hydrate: vi.fn(), syncAuthProfiles: vi.fn() },
  tasks: { hydrate: vi.fn() },
  usage: { hydrate: vi.fn() },
  subscription: { hydrate: vi.fn() }
}))
vi.mock('../../stores/workspace-store', () => ({ useWorkspaceStore: { getState: () => states.workspace } }))
vi.mock('../../stores/editor-store', () => ({ useEditorStore: { getState: () => states.editor } }))
vi.mock('../../stores/ai-accounts-store', () => ({ useAiAccountsStore: { getState: () => states.accounts } }))
vi.mock('../../stores/tasks-store', () => ({ useTasksStore: { getState: () => states.tasks } }))
vi.mock('../../stores/usage-store', () => ({ useUsageStore: { getState: () => states.usage } }))
vi.mock('../../stores/subscription-store', () => ({ useSubscriptionStore: { getState: () => states.subscription } }))
vi.mock('../../stores/git-store', () => ({ useGitStore: {}, selectGitBundle: vi.fn(), selectGitChanges: vi.fn() }))
import { hydrateFromDisk } from '../persistence-sync'

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('loads the workspace without waiting for account verification and applies profiles later', async () => {
  let resolveProfiles!: (profiles: AuthProfileSummary[]) => void
  const waiting = new Promise<AuthProfileSummary[]>((resolve) => { resolveProfiles = resolve })
  const snapshot = { projects: [{ id: 'saved-project' }], activeProjectId: 'saved-project', workspaces: {},
    editor: {}, accounts: [], activeAccountByKind: {}, usage: {}, subscriptions: [] }
  const dispatchEvent = vi.fn()
  vi.stubGlobal('window', { dispatchEvent, api: {
    persistence: { load: vi.fn(async () => snapshot) }, authProfiles: { list: vi.fn(() => waiting) }
  } })
  await hydrateFromDisk()
  expect(states.workspace.hydrate).toHaveBeenCalledWith({ projects: snapshot.projects,
    activeProjectId: 'saved-project', workspaces: {} })
  expect(states.accounts.syncAuthProfiles).not.toHaveBeenCalled()
  const profiles: AuthProfileSummary[] = [{ kind: 'cursor', accountId: 'a', ready: true, email: 'a@example.com', name: 'a' }]
  resolveProfiles(profiles)
  await vi.waitFor(() => expect(states.accounts.syncAuthProfiles).toHaveBeenCalledWith(profiles))
  expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'bikorch:refresh-ai-accounts' }))
})
