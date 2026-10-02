import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TerminalView } from '../../src/renderer/components/terminal/TerminalView'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace-store'
import { useAiAccountsStore } from '../../src/renderer/stores/ai-accounts-store'
import type { PtyCreateRequest, PtyEvent, PtySessionSnapshot } from '../../src/shared/contracts/pty'
import '../../src/renderer/styles/globals.css'
import '../../src/renderer/styles/workstation.css'

const creates: PtyCreateRequest[] = []
const listeners = new Set<(event: PtyEvent) => void>()
const sessions = new Map<string, PtySessionSnapshot>()
let profileReady = false
let worktrees = 0
let remount = (): void => {}
Object.assign(window, { api: {
  cli: { detect: async () => ({ installed: true, command: 'fixture' }) },
  authProfiles: { inspect: async () => ({ ok: true, ready: profileReady, identity: { email: 'saved@example.com', name: 'Saved account' } }) },
  git: { ensureWorktree: async ({ panelId }: { panelId: string }) => { worktrees++; return { ok: true, worktreePath: `/project/worktree-${panelId}` } } },
  pty: {
    snapshot: async (id: string) => sessions.get(id) ?? null,
    create: async (request: PtyCreateRequest) => {
      creates.push(structuredClone(request))
      const existing = sessions.get(request.sessionId)
      if (existing?.status === 'running') {
        if (existing.cwd !== request.cwd) return { sessionId: request.sessionId, status: 'error', error: 'Live terminal moved to another folder' }
        return { sessionId: request.sessionId, status: 'running', reattached: true }
      }
      if (request.launchMode !== 'login' && !profileReady) return { sessionId: request.sessionId, status: 'error', error: 'Sign in required', code: 'ACCOUNT_REQUIRED' }
      sessions.set(request.sessionId, { ...request, status: 'running' })
      return { sessionId: request.sessionId, status: 'running' }
    },
    onEvent: (callback: (event: PtyEvent) => void) => { listeners.add(callback); return () => listeners.delete(callback) },
    resize: async () => {}, write: async () => {},
    kill: async ({ sessionId }: { sessionId: string }) => { sessions.delete(sessionId) }
  }
} })
useWorkspaceStore.getState().addProject('Login continuity', '/project')
const accountId = useAiAccountsStore.getState().addAccount({ kind: 'codex', name: 'New Codex account', email: '', plan: '', note: '' })
useWorkspaceStore.getState().addPanel('codex', 'center', undefined, 'login', accountId)

Object.assign(window, { loginFixture: {
  creates, accountId,
  worktrees: () => worktrees,
  accounts: () => useAiAccountsStore.getState().accounts,
  panel: () => useWorkspaceStore.getState().getActiveWorkspace()?.panels.find((panel) => panel.type === 'codex'),
  setReady: (value: boolean) => { profileReady = value },
  remount: () => remount(),
  end: () => {
    const panel = useWorkspaceStore.getState().getActiveWorkspace()?.panels.find((item) => item.type === 'codex')
    if (!panel) return
    const session = sessions.get(panel.id)
    if (session) session.status = 'stopped'
    for (const listener of listeners) listener({ type: 'exit', sessionId: panel.id, exitCode: 0 })
  }
} })

function Fixture(): React.JSX.Element {
  const [generation, setGeneration] = useState(0)
  remount = () => setGeneration((value) => value + 1)
  const workspace = useWorkspaceStore((state) => state.getActiveWorkspace())
  const panel = workspace?.panels.find((item) => item.type === 'codex')
  return <div className="app-shell" style={{ width: '100vw', height: '100vh' }}>
    {panel && <TerminalView key={`${panel.id}:${generation}`} sessionId={panel.id} kind="codex" accountId={panel.accountId} launchMode={panel.launchMode} />}
  </div>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
