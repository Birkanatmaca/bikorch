// Real Manager UI with isolated, in-memory IPC. No user files, keys, CLIs or API calls.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DeveloperSecretary } from '../../src/renderer/components/workspace/DeveloperSecretary'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace-store'
import { useSecretaryStore } from '../../src/renderer/stores/secretary-store'
import { useTerminalStore } from '../../src/renderer/stores/terminal-store'
import { defaultManagerProviderView } from '../../src/shared/contracts/secretary'
import type {
  SecretaryChatRequest, SecretaryChatResponse, SecretaryEvent, SecretaryMessage, SecretaryPlan,
  SecretaryRun, SecretarySessionSummary, SecretarySettings, SecretaryThreadDetail
} from '../../src/shared/contracts/secretary'
import type { Project, PanelDefinition } from '../../src/shared/types'
import { createDefaultPanels, DEFAULT_LAYOUT } from '../../src/shared/types'
import '../../src/renderer/styles/globals.css'
import '../../src/renderer/styles/workstation.css'
import '../../src/renderer/styles/studio.css'
import '../../src/renderer/styles/manager.css'

const project: Project = { id: 'manager-project', name: 'Aurora Studio', folderPath: '/fixture/aurora-studio' }
const panel: PanelDefinition = {
  id: 'manager-agent', type: 'claude', title: 'API implementation', zone: 'center',
  panelRole: 'secretary', workspaceIsolation: 'isolated', worktreePath: '/fixture/agent-worktrees/claude'
}
const now = Date.now()
const provider = defaultManagerProviderView('gpt-5')
provider.api = { ...provider.api, hasKey: true, status: 'connected', statusLabel: 'Connected' }
const settings: SecretarySettings = {
  configured: true, model: 'gpt-5', provider,
  usage: { requests: 2, inputTokens: 500, cachedInputTokens: 200, outputTokens: 100, totalTokens: 600, estimatedCostUsd: 0.002, lastRequestAt: now }
}
const plan: SecretaryPlan = {
  overview: 'Repair the API handler and verify the affected route.', assumptions: ['Keep the existing API contract.'], approvalRequired: true,
  assignments: [{
    id: 'repair-api', panelId: panel.id, kind: 'claude', mode: 'implement', title: 'Repair API handler',
    instruction: 'Fix the failing API handler, run the route test, and report the evidence.',
    expectedResult: 'The affected route test passes.', rationale: 'The CLI owns the existing API task.', usageNote: 'Available'
  }]
}
const currentThread = { id: 'manager-current', projectId: project.id, title: 'Project conversation', status: 'active' as const, createdAt: now, updatedAt: now }
const oldThread = { id: 'manager-history', projectId: project.id, title: 'Previous API review', status: 'active' as const, createdAt: now - 86_400_000, updatedAt: now - 86_400_000 }
const messages: SecretaryMessage[] = []
const runs = new Map<string, SecretaryRun>()
const events = new Set<(event: SecretaryEvent) => void>()
const chatRequests: SecretaryChatRequest[] = []
const dispatches: unknown[] = []
let failChat = false
let savedSnapshots = 0
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function summaries(): SecretarySessionSummary[] {
  return [
    { ...currentThread, messageCount: messages.length, work: [] },
    { ...oldThread, messageCount: 2, work: [{ label: 'Review API route', status: 'completed' }] }
  ]
}

function createRun(id: string): SecretaryRun {
  return {
    id, threadId: currentThread.id, projectId: project.id, status: 'awaiting-approval', requestText: 'Fix the API error',
    reply: 'I can repair this issue and verify the route.', plan: structuredClone(plan), planRevision: 1,
    openKinds: [], errorCode: null, errorMessage: null, sessionBindings: [], evidence: null, createdAt: now, updatedAt: now
  }
}

function appendMessage(role: 'user' | 'assistant', content: string, runId: string | null = null): void {
  messages.push({ id: `stored-${messages.length}`, threadId: currentThread.id, runId, assignmentId: null, role, type: 'chat', content, createdAt: Date.now() })
}

const secretary = {
  getSettings: async () => structuredClone(settings),
  updateSettings: async () => structuredClone(settings),
  listSessions: async () => summaries(),
  listRuns: async () => [...runs.values()],
  getThread: async (threadId: string): Promise<SecretaryThreadDetail> => ({
    thread: threadId === oldThread.id ? oldThread : currentThread,
    messages: threadId === oldThread.id
      ? [{ id: 'history-message', threadId, runId: null, assignmentId: null, role: 'assistant', type: 'chat', content: 'The previous API review found no regressions.', createdAt: oldThread.createdAt }]
      : structuredClone(messages),
    runs: [...runs.values()], hasOlderMessages: false
  }),
  onEvent: (listener: (event: SecretaryEvent) => void) => { events.add(listener); return () => events.delete(listener) },
  chat: async (request: SecretaryChatRequest): Promise<SecretaryChatResponse> => {
    chatRequests.push(structuredClone(request))
    await delay(180)
    if (failChat) throw new Error('Manager connection timed out. Retry when the provider is reachable.')
    if (request.purpose) {
      const reply = request.purpose === 'error-diagnosis'
        ? 'Error diagnosis: the users handler reads id before checking the request body. Inspect src/api/users.ts:42, guard the missing input, and run the route regression test.'
        : 'Project review: React and TypeScript workspace, two changed files, one API route without a regression test. Review the handler before the next release.'
      appendMessage('assistant', reply)
      return { reply, plan: null, openKinds: [], actions: [], threadId: currentThread.id }
    }
    const proposePlan = /fix|repair/i.test(request.message)
    const runId = proposePlan ? `run-${runs.size + 1}` : null
    if (runId) runs.set(runId, createRun(runId))
    const reply = proposePlan ? 'I found the failing API handler. Here is the repair plan.' : [
      'Aurora uses React and TypeScript. The API route needs a focused regression test.',
      '', '### Next check', '- Validate `request.body` before reading **id**.',
      '- Add a route regression test.', '', '```ts', 'const id = request.body?.id', '```',
      '', '<script>window.managerUnsafeMarkup = true</script>'
    ].join('\n')
    appendMessage('user', request.message)
    appendMessage('assistant', reply, runId)
    return { reply, plan: proposePlan ? structuredClone(plan) : null, openKinds: [], threadId: currentThread.id, ...(runId ? { runId, planRevision: 1 } : {}) }
  },
  prepareRun: async ({ runId, assignments }: { runId: string; assignments: Array<{ assignmentId: string; sessionId: string }> }) => {
    const run = runs.get(runId)!
    run.sessionBindings = assignments.map((assignment) => ({ ...assignment, accountId: null }))
    return structuredClone(run)
  },
  approvePlan: async (runId: string) => { runs.get(runId)!.status = 'approved'; return structuredClone(runs.get(runId)) },
  dispatchRun: async (request: { runId: string; assignments: Array<{ assignmentId: string }> }) => {
    dispatches.push(structuredClone(request)); runs.get(request.runId)!.status = 'running'
    return { dispatchedAssignmentIds: request.assignments.map((assignment) => assignment.assignmentId) }
  },
  getRun: async (runId: string) => structuredClone(runs.get(runId) ?? null),
  rejectPlan: async (runId: string) => { runs.get(runId)!.status = 'rejected' },
  cancelRun: async ({ runId }: { runId: string }) => { runs.get(runId)!.status = 'cancelled' },
  renameThread: async ({ title }: { title: string }) => { oldThread.title = title },
  deleteThread: async () => undefined
}

Object.assign(window, {
  api: {
    secretary,
    persistence: { save: async () => { savedSnapshots += 1 }, onFlushRequest: () => () => {}, finishFlush: () => {} },
    developerIntelligence: {
      getContext: async () => ({ injectionEnabled: true, memories: [{ id: 'memory-1', category: 'preference', content: 'Prefer small, verified changes.' }] })
    },
    resources: { cacheAnalysis: async () => ({ collectedAt: now, warnAtMb: 256, clearableBytes: 0, pressured: false, dismissed: false, parts: [], recommendation: '', signature: 'fixture', releasedBytes: null }) },
    pty: { write: async () => undefined, destroy: async () => undefined },
    git: {
      status: async () => ({ branch: 'main', changes: [{ path: 'src/api/users.ts', status: 'M', staged: false }, { path: 'src/App.tsx', status: 'M', staged: false }], recentCommits: [{ hash: 'fixture-commit', shortHash: 'fixture', author: 'Fixture', date: new Date(now).toISOString(), subject: 'Add API route' }], branches: ['main'], isRepo: true, remoteName: null, remoteUrl: null, upstream: null, ahead: 0, behind: 0 }),
      diff: async ({ filePath }: { filePath: string }) => ({ original: 'export const route = null', modified: 'export const route = request.body.id', filePath, language: 'typescript' }),
      discover: async () => ({ repos: [] })
    },
    agentWorkspace: { onProjectActivity: () => () => {} }
  },
  managerFixture: {
    chatRequests, dispatches,
    subscriptions: () => events.size,
    savedSnapshots: () => savedSnapshots,
    setChatFailure: (value: boolean) => { failChat = value },
    setDisconnected: (value: boolean) => { settings.configured = !value; useSecretaryStore.setState({ settings: structuredClone(settings) }) },
    terminalError: (message = 'TypeError: Cannot read properties of undefined (reading id) at src/api/users.ts:42:18') => {
      useTerminalStore.getState().setOutputTail(panel.id, message)
      useTerminalStore.getState().setStatus(panel.id, 'error', message)
    },
    terminalReady: () => {
      useTerminalStore.getState().setOutputTail(panel.id, 'Ready for your next task\n❯ ')
      useTerminalStore.getState().setStatus(panel.id, 'waiting')
    },
    emitFailure: (message: string, runId = 'run-1') => {
      const event: SecretaryEvent = { type: 'run-failed', projectId: project.id, threadId: currentThread.id, runId, message }
      for (const listener of events) listener(event)
    },
    sidebar: () => useWorkspaceStore.getState().getActiveWorkspace()?.layout.leftSidebarView,
    panels: () => useWorkspaceStore.getState().getActiveWorkspace()?.panels ?? [],
    projectId: project.id
  }
})
window.localStorage.setItem('bikorch.secretarySidebarOpen', '1')
useWorkspaceStore.getState().hydrate({ projects: [project], activeProjectId: project.id, workspaces: { [project.id]: { projectId: project.id, panels: [...createDefaultPanels(), panel], layout: { ...DEFAULT_LAYOUT } } } })
useSecretaryStore.setState({ settings, loaded: true })
useTerminalStore.getState().setStatus(panel.id, 'waiting')
useTerminalStore.getState().setOutputTail(panel.id, 'Ready for your next task\n❯ ')

function Fixture() {
  const panels = useWorkspaceStore((state) => state.workspaces[project.id]?.panels ?? [])
  return <div className="app-shell flex h-full flex-col"><div className="workspace-frame relative flex min-h-0 flex-1" style={{ padding: 12 }}>
    <div className="workspace-main flex min-w-0 flex-1 flex-col" style={{ padding: 24, gap: 12 }}>
      <span style={{ color: '#a49ac1', fontSize: 12 }}>BIKORCH / AURORA STUDIO</span>
      <strong style={{ color: '#eee9ff', fontSize: 26 }}>Developer workspace</strong>
      <p style={{ color: '#9090a4', fontSize: 13 }}>An isolated preview of Manager's real project conversation.</p>
    </div>
    <DeveloperSecretary project={project} panels={panels} />
  </div></div>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
