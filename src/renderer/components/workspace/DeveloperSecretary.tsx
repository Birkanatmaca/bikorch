import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowUp, Check, ChevronDown, Code2, Loader2, PanelRightClose, Plus, ScanSearch, SlidersHorizontal } from 'lucide-react'
import type { PanelDefinition, Project } from '@shared/types'
import type { ManagerAppAction, SecretaryMessageCursor, SecretaryPlan, SecretaryRun, SecretaryRunStatus, SecretarySessionSummary, SecretarySessionWork, SecretaryThreadDetail } from '@shared/contracts/secretary'
import type { CacheAnalysis } from '@shared/contracts/resources'
import type { WorkspaceCanvasMode } from '@shared/types'
import { AI_ACCOUNT_KINDS, AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import type { PtySessionStatus } from '@shared/contracts/pty'
import type { MemoryContextItem } from '@shared/contracts/developer-intelligence'
import type { CliUsageKind } from '@shared/contracts/usage'
import { pickCliAccountId } from '@shared/cli-account'
import { AppLogo } from '@renderer/components/brand/AppLogo'
import { SecretaryAvatar, type SecretaryAvatarMood } from './SecretaryAvatar'
import { ManagerConversation, type ManagerChatItem } from './ManagerConversation'
import { focusTerminal, focusWorkspacePanel, OPEN_MANAGER_EVENT } from '@renderer/lib/app-events'
import { isTiledWorkspace, syncGridWithPanelIds, tiledCenterPanelIds } from '@shared/workspace-grid'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useSecretaryStore } from '@renderer/stores/secretary-store'
import { useUsageStore } from '@renderer/stores/usage-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { cliPermissionResponse, looksWorkspaceTrustPrompt } from '@shared/cli-permission'
import { inferCliActivity, stripAnsi } from '@renderer/lib/cli-activity'
import { submitCliPrompt } from '@renderer/lib/submit-cli-prompt'
import { flushPersistence } from '@renderer/lib/persistence-sync'
import { cn } from '@renderer/lib/utils'
import { useManagerProjectWatch } from '@renderer/hooks/use-manager-project-watch'
import { managerFailureSignals } from '@renderer/lib/manager-watch'

const CLI_TYPES = new Set(AI_ACCOUNT_KINDS)

type ChatItem = ManagerChatItem

function workspaceForRequest(actions: ManagerAppAction[], plan: SecretaryPlan | null): ManagerAppAction[] {
  const prepared = [...actions]
  const add = (action: ManagerAppAction): void => {
    if (!prepared.includes(action) && prepared.length < 4) prepared.push(action)
  }
  const modes = new Set(plan?.assignments.map((assignment) => assignment.mode) ?? [])
  if (modes.has('review') || modes.has('validate')) add('show-changes')
  else if (modes.has('implement') || modes.has('analyze')) add('show-files')
  return prepared
}

function presentWorkingPanels(panelIds: string[]): void {
  const store = useWorkspaceStore.getState()
  const projectId = store.activeProjectId
  const workspace = store.getActiveWorkspace()
  if (!projectId || !workspace) return
  const visible = panelIds.filter((id) => workspace.panels.some((panel) => panel.id === id))
  for (const panelId of visible) {
    const panel = workspace.panels.find((item) => item.id === panelId)
    if (panel && panel.zone !== 'center') store.movePanel(panelId, 'center')
  }
  const next = store.getActiveWorkspace()
  if (!next) return
  if (isTiledWorkspace(next.layout)) {
    store.updateLayout(projectId, {
      centerGrid: syncGridWithPanelIds(next.layout.centerGrid ?? null, tiledCenterPanelIds(next.panels))
    })
  } else {
    visible.forEach((panelId, index) => {
      const columns = Math.min(visible.length, 2)
      const width = columns === 1 ? 78 : 46
      store.updateCenterPanelRect(panelId, {
        x: 4 + (index % columns) * 48,
        y: 6 + Math.floor(index / columns) * 46,
        w: width,
        h: visible.length > 2 ? 42 : 84
      })
    })
  }
  const focusId = visible.at(-1)
  if (!focusId) return
  focusWorkspacePanel(focusId)
  focusTerminal(focusId)
}

function planStatusForRun(status: SecretaryRunStatus): ChatItem['planStatus'] {
  if (status === 'awaiting-approval') return 'awaiting-approval'
  if (status === 'completed') return 'completed'
  if (status === 'rejected') return 'rejected'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'interrupted') return 'interrupted'
  if (status === 'failed') return 'failed'
  return 'sent'
}

function chatItemsFromThread(detail: SecretaryThreadDetail): ChatItem[] {
  const runs = new Map(detail.runs.map((run) => [run.id, run]))
  const unansweredQuestions = new Map<string, string>()
  for (const message of detail.messages) {
    if (!message.runId) continue
    const key = message.assignmentId ? `${message.runId}:${message.assignmentId}` : message.runId
    if (message.role === 'assistant' && message.type === 'needs-user') {
      unansweredQuestions.set(key, message.id)
    } else if (message.role === 'user' && message.assignmentId) {
      unansweredQuestions.delete(key)
    }
  }
  return detail.messages.map((message) => {
    const run = message.runId ? runs.get(message.runId) : undefined
    const plan = message.role === 'assistant' && message.type === 'chat' ? run?.plan ?? null : null
    const questionKey = message.runId
      ? message.assignmentId ? `${message.runId}:${message.assignmentId}` : message.runId
      : null
    const isUnansweredQuestion = Boolean(
      questionKey &&
      run?.status === 'needs-user' &&
      unansweredQuestions.get(questionKey) === message.id
    )
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(run ? { run } : {}),
      ...(run?.requestText.startsWith('Follow-up requested after CLI result for:') ? { followUp: true } : {}),
      ...(plan
        ? {
            plan,
            ...(run ? {
              runId: run.id,
              planRevision: run.planRevision,
              planOpenKinds: run.openKinds,
              planStatus: planStatusForRun(run.status)
            } : {})
          }
        : {}),
      ...(isUnansweredQuestion && run
        ? {
            runId: run.id,
            awaitingAnswer: true,
            ...(message.assignmentId ? { awaitingAssignmentId: message.assignmentId } : {})
          }
        : {}),
      ...(message.role === 'assistant' && message.type === 'final-report' && run?.evidence
        ? { report: run.evidence }
        : {}),
      error: message.type === 'error'
    }
  })
}

const SECRETARY_OPEN_KEY = 'bikorch.secretarySidebarOpen'

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readSecretaryOpen(): boolean {
  try {
    return window.localStorage.getItem(SECRETARY_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeSecretaryOpen(open: boolean): void {
  try {
    window.localStorage.setItem(SECRETARY_OPEN_KEY, open ? '1' : '0')
  } catch {
    // Sidebar preference is local-only; chat still works if storage is blocked.
  }
}

function operationTone(status: PtySessionStatus | undefined): string {
  if (status === 'waiting') return 'is-ready'
  if (status === 'busy' || status === 'running') return 'is-busy'
  if (status === 'starting') return 'is-starting'
  if (status === 'error') return 'is-error'
  return 'is-idle'
}

function sameLocalDay(timestamp: number, now: number): boolean {
  const left = new Date(timestamp)
  const right = new Date(now)
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

function sessionDayLabel(timestamp: number, now = Date.now()): string {
  const dayStart = (value: number): number => {
    const date = new Date(value)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  }
  const days = Math.round((dayStart(now) - dayStart(timestamp)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(timestamp))
}

function sessionWorkLabel(work: SecretarySessionWork): string {
  const status = work.status === 'completed'
    ? 'Done'
    : work.status === 'failed'
      ? 'Failed'
      : work.status === 'cancelled'
        ? 'Cancelled'
        : work.status === 'rejected'
          ? 'Rejected'
          : work.status === 'interrupted'
            ? 'Interrupted'
            : 'Active'
  return `${status}: ${work.label}`
}

function operationLabel(status: PtySessionStatus | undefined): string {
  if (status === 'waiting') return 'Ready'
  if (status === 'busy' || status === 'running') return 'Working'
  if (status === 'starting') return 'Starting'
  if (status === 'error') return 'Error'
  if (status === 'stopped') return 'Stopped'
  return 'Idle'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function waitForCliIdle(sessionId: string, timeoutMs = 60000): Promise<boolean> {
  const started = Date.now()
  let trustReplies = 0
  while (Date.now() - started < timeoutMs) {
    const terminal = useTerminalStore.getState()
    const status = terminal.getStatus(sessionId)
    if (status === 'error') {
      throw new Error(terminal.errors[sessionId] ?? 'The CLI could not be started.')
    }
    if (status === 'stopped') {
      throw new Error('The CLI process exited before the task could be sent.')
    }
    const tail = stripAnsi(terminal.getOutputTail(sessionId))
    const panel = useWorkspaceStore.getState().getActiveWorkspace()?.panels.find((item) => item.id === sessionId)
    const managedWorktree = Boolean(panel?.worktreePath && panel.worktreePath.includes('/agent-worktrees/'))
    const permission = cliPermissionResponse(tail, { managedWorktree })
    if (looksWorkspaceTrustPrompt(tail) && permission && trustReplies < 3) {
      trustReplies += 1
      await window.api.pty.write({ sessionId, data: permission })
      await sleep(400)
      continue
    }
    if (looksWorkspaceTrustPrompt(tail) && !managedWorktree) {
      throw new Error('The CLI is waiting for workspace trust. Review and approve it in the terminal before sending this task.')
    }
    if (inferCliActivity(tail) === 'waiting') return true
    await sleep(250)
  }
  return inferCliActivity(stripAnsi(useTerminalStore.getState().getOutputTail(sessionId))) === 'waiting'
}

export function DeveloperSecretary({ project, panels }: { project: Project; panels: PanelDefinition[] }): React.JSX.Element {
  const usage = useUsageStore((state) => state.providers)
  const terminalSessions = useTerminalStore((state) => state.sessions)
  const selectLeftSidebar = useWorkspaceStore((state) => state.selectLeftSidebar)
  const addPanel = useWorkspaceStore((state) => state.addPanel)
  const includeMemory = useDeveloperIntelligenceStore((state) => state.settings.includeMemoryInPrompts)
  const memoryCount = useDeveloperIntelligenceStore((state) => state.memories.length)
  const settings = useSecretaryStore((state) => state.settings)
  const settingsLoaded = useSecretaryStore((state) => state.loaded)
  const accounts = useAiAccountsStore((state) => state.accounts)
  const loadSettings = useSecretaryStore((state) => state.load)
  const [brief, setBrief] = useState('')
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [oldestMessageCursor, setOldestMessageCursor] = useState<SecretaryMessageCursor | null>(null)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [open, setOpen] = useState(readSecretaryOpen)
  const [loading, setLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [inspectionKind, setInspectionKind] = useState<'project-review' | 'error-diagnosis' | null>(null)
  const [watchError, setWatchError] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [answering, setAnswering] = useState(false)
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [managerSessions, setManagerSessions] = useState<SecretarySessionSummary[]>([])
  const [sessionsTick, setSessionsTick] = useState(0)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [cacheAnalysis, setCacheAnalysis] = useState<CacheAnalysis | null>(null)
  const [cacheBusy, setCacheBusy] = useState(false)
  const [recoveryRuns, setRecoveryRuns] = useState<SecretaryRun[]>([])
  const [editingPlanMessageId, setEditingPlanMessageId] = useState<string | null>(null)
  const [planDraft, setPlanDraft] = useState<SecretaryPlan | null>(null)
  const [managerMemory, setManagerMemory] = useState<{ enabled: boolean; facts: MemoryContextItem[] }>({
    enabled: true,
    facts: []
  })
  const [revisingPlan, setRevisingPlan] = useState(false)
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const preservedScrollRef = useRef<{ height: number; top: number } | null>(null)
  const runRef = useRef(0)
  const approvingPlanIdsRef = useRef(new Set<string>())
  const chatFlightRef = useRef(false)

  const cliPanels = useMemo(() => panels.filter((panel) => CLI_TYPES.has(panel.type as typeof AI_ACCOUNT_KINDS[number])).map((panel) => ({
    id: panel.id,
    kind: panel.type as typeof AI_ACCOUNT_KINDS[number],
    accountId: panel.accountId,
    title: panel.title,
    status: terminalSessions[panel.id] ?? 'stopped'
  })), [panels, terminalSessions])

  // Planning may only name a panel that approval can actually dispatch into.
  // A personal or shared CLI stays visible in the sidebar, but it is not a
  // Manager assignment target.
  const routingPanels = useMemo(() => panels.filter((panel) => (
    CLI_TYPES.has(panel.type as typeof AI_ACCOUNT_KINDS[number]) &&
    panel.panelRole === 'secretary' &&
    panel.workspaceIsolation === 'isolated' &&
    !panel.cwdOverride
  )).map((panel) => ({
    id: panel.id,
    kind: panel.type as typeof AI_ACCOUNT_KINDS[number],
    accountId: panel.accountId,
    title: panel.title,
    status: terminalSessions[panel.id] ?? 'stopped'
  })), [panels, terminalSessions])

  useEffect(() => {
    if (!settingsLoaded) void loadSettings()
  }, [loadSettings, settingsLoaded])

  useEffect(() => {
    if (!open) return
    let active = true
    void window.api.developerIntelligence.getContext({
      projectId: project.id,
      limit: 4,
      retainProfile: true
    }).then((pack) => {
      if (!active) return
      setManagerMemory({ enabled: pack.injectionEnabled, facts: pack.memories.slice(0, 3) })
    }).catch(() => undefined)
    return () => {
      active = false
    }
  }, [open, project.id, includeMemory, memoryCount])

  const setSidebarOpen = (next: boolean): void => {
    setOpen(next)
    writeSecretaryOpen(next)
  }

  useEffect(() => {
    runRef.current += 1
    setMessages([])
    setOldestMessageCursor(null)
    setHasOlderMessages(false)
    setLoadingOlderMessages(false)
    preservedScrollRef.current = null
    setBrief('')
    setLoading(false)
    setHistoryLoaded(false)
    setInspectionKind(null)
    setWatchError(null)
    setToolsOpen(false)
    chatFlightRef.current = false
    setSending(false)
    setAnswering(false)
    setFeedback(null)
    setThreadId(null)
    setManagerSessions([])
    setRenamingSessionId(null)
    setSessionTitle('')
    setPendingDeleteId(null)
    setSessionError(null)
    setRecoveryRuns([])
    setEditingPlanMessageId(null)
    setPlanDraft(null)
    setRevisingPlan(false)
    setCancellingRunId(null)
    approvingPlanIdsRef.current.clear()
  }, [project.id])

  useEffect(() => {
    const openSidebar = (): void => setSidebarOpen(true)
    window.addEventListener(OPEN_MANAGER_EVENT, openSidebar)
    return () => window.removeEventListener(OPEN_MANAGER_EVENT, openSidebar)
  }, [])

  useEffect(() => {
    let active = true
    const loadCache = (): void => {
      void window.api.resources.cacheAnalysis().then((analysis) => {
        if (!active) return
        setCacheAnalysis(analysis)
      }).catch(() => undefined)
    }
    loadCache()
    window.addEventListener('bikorch:cache-care', loadCache)
    return () => {
      active = false
      window.removeEventListener('bikorch:cache-care', loadCache)
    }
  }, [])

  const answerCache = async (accept: boolean): Promise<void> => {
    setCacheBusy(true)
    try {
      setCacheAnalysis(await window.api.resources.respondCache(accept))
    } catch {
      setCacheAnalysis((current) => current)
    } finally {
      setCacheBusy(false)
    }
  }

  useEffect(() => {
    const run = runRef.current
    const restoreMostRecentThread = async (): Promise<void> => {
      try {
        const [nextSessions, runs] = await Promise.all([
          window.api.secretary.listSessions(project.id),
          window.api.secretary.listRuns(project.id)
        ])
        if (run !== runRef.current) return
        setManagerSessions(nextSessions)
        setRecoveryRuns(runs.filter((item) => item.status === 'interrupted' && item.sessionBindings.length > 0).slice(0, 3))
        const thread = nextSessions[0]
        if (!thread || !sameLocalDay(thread.updatedAt, Date.now())) return
        const detail = await window.api.secretary.getThread(thread.id)
        if (!detail || run !== runRef.current) return
        setThreadId(detail.thread.id)
        setMessages(chatItemsFromThread(detail))
        setOldestMessageCursor(detail.messages[0]
          ? { createdAt: detail.messages[0].createdAt, id: detail.messages[0].id }
          : null)
        setHasOlderMessages(detail.hasOlderMessages)
      } catch {
        // Secretary remains usable without local conversation history.
      } finally {
        if (run === runRef.current) setHistoryLoaded(true)
      }
    }
    void restoreMostRecentThread()
  }, [project.id])

  useEffect(() => {
    let active = true
    void window.api.secretary.listSessions(project.id).then((next) => {
      if (active) setManagerSessions(next)
    }).catch(() => undefined)
    return () => {
      active = false
    }
  }, [project.id, sessionsTick])

  useEffect(() => window.api.secretary.onEvent((event) => {
    if (event.projectId !== project.id) return
    setSessionsTick((value) => value + 1)
    if (event.threadId !== threadId) return
    if (event.type === 'run-report') {
      const failed = event.evidence.assignments.some((assignment) => assignment.outcome === 'failed')
      setSidebarOpen(true)
      setMessages((current) => [
        ...current.map((item) => item.runId === event.runId
          ? { ...item, planStatus: failed ? 'failed' as const : 'completed' as const, awaitingAnswer: false,
              ...(item.run ? { run: { ...item.run, status: failed ? 'failed' as const : 'completed' as const, evidence: event.evidence } } : {}) }
          : item),
        {
          id: newId(),
          role: 'assistant',
          content: event.reply,
          runId: event.runId,
          report: event.evidence
        }
      ])
      setFeedback(null)
      return
    }
    if (event.type === 'run-followup') {
      setSidebarOpen(true)
      const completedStatus = event.completedStatus ?? 'completed'
      setMessages((current) => [
        ...current.map((item) => item.runId === event.completedRunId
          ? { ...item, planStatus: completedStatus, awaitingAnswer: false,
              ...(item.run ? { run: { ...item.run, status: completedStatus, evidence: event.completedEvidence } } : {}) }
          : item),
        { id: newId(), role: 'assistant', content: event.reply, runId: event.completedRunId, report: event.completedEvidence },
        {
          id: newId(),
          role: 'assistant',
          content: completedStatus === 'failed'
            ? 'A repair plan is ready for review.'
            : 'A follow-up plan is ready for review.',
          plan: event.plan,
          followUp: true,
          runId: event.runId,
          planOpenKinds: event.openKinds,
          planStatus: 'awaiting-approval' as const
        }
      ])
      setFeedback(null)
      return
    }
    if (event.type === 'run-needs-user') {
      setSidebarOpen(true)
      setMessages((current) => [
        ...current.map((item) => item.runId === event.runId && item.run
          ? { ...item, run: { ...item.run, status: 'needs-user' as const } } : item),
        {
          id: newId(),
          role: 'assistant',
          content: `${event.assignmentTitle}: ${event.message}`,
          runId: event.runId,
          awaitingAnswer: true,
          awaitingAssignmentId: event.assignmentId
        }
      ])
      setFeedback('The agent needs input. Use its answer card when you are ready.')
      return
    }
    setSidebarOpen(true)
    setMessages((current) => [
      ...current.map((item) => item.runId === event.runId
        ? { ...item, planStatus: 'failed' as const, awaitingAnswer: false }
        : item),
      { id: newId(), role: 'assistant', content: event.message, error: true }
    ])
    setFeedback(null)
  }), [project.id, threadId])

  useLayoutEffect(() => {
    const node = logRef.current
    if (!node) return
    const preserved = preservedScrollRef.current
    if (preserved) {
      node.scrollTop = preserved.top + node.scrollHeight - preserved.height
      preservedScrollRef.current = null
      return
    }
    node.scrollTop = node.scrollHeight
  }, [messages, loading, open])

  const loadOlderMessages = async (): Promise<void> => {
    if (!threadId || !oldestMessageCursor || !hasOlderMessages || loadingOlderMessages) return
    const run = runRef.current
    setLoadingOlderMessages(true)
    try {
      const detail = await window.api.secretary.getThread(threadId, oldestMessageCursor)
      if (!detail || run !== runRef.current) return
      const node = logRef.current
      if (node) preservedScrollRef.current = { height: node.scrollHeight, top: node.scrollTop }
      setMessages((current) => [...chatItemsFromThread(detail), ...current])
      setOldestMessageCursor(detail.messages[0]
        ? { createdAt: detail.messages[0].createdAt, id: detail.messages[0].id }
        : null)
      setHasOlderMessages(detail.hasOlderMessages)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not load earlier messages.')
    } finally {
      if (run === runRef.current) setLoadingOlderMessages(false)
    }
  }

  const applyWorkspaceActions = (openKinds: CliUsageKind[], plan: SecretaryPlan | null): {
    plan: SecretaryPlan | null
    openedPanelIds: string[]
  } => {
    if (useWorkspaceStore.getState().activeProjectId !== project.id) {
      throw new Error('The active project changed. Reopen this Manager conversation before approving the plan.')
    }
    const accounts = useAiAccountsStore.getState().accounts
    const activeByKind = useAiAccountsStore.getState().activeAccountByKind
    const usedPanelIds = new Set<string>()
    const openedPanelIds: string[] = []

    const bindPanel = (
      kind: CliUsageKind,
      preferredPanelId?: string | null,
      taskTitle?: string,
      preferFreshSession = false
    ): string => {
      const accountId = pickCliAccountId(kind, accounts, usage, activeByKind[kind])
      const livePanels = useWorkspaceStore.getState().getActiveWorkspace()?.panels ?? panels
      const sessionStatus = (panelId: string) => useTerminalStore.getState().getStatus(panelId)
      const usable = (panel: PanelDefinition): boolean =>
        panel.type === kind &&
        panel.panelRole === 'secretary' &&
        panel.workspaceIsolation === 'isolated' &&
        !panel.cwdOverride &&
        !usedPanelIds.has(panel.id)
      const healthy = (panel: PanelDefinition): boolean => {
        const status = sessionStatus(panel.id)
        return status === 'waiting' || status === 'running' || status === 'busy' || status === 'starting'
      }
      const rank = (panel: PanelDefinition): number => {
        const status = sessionStatus(panel.id)
        let score = 0
        if (preferredPanelId && panel.id === preferredPanelId) score += 100
        if (status === 'waiting') score += 40
        if (status === 'busy' || status === 'running') score += 30
        if (status === 'starting') score += 10
        if (status === 'error' || status === 'stopped') score -= 50
        if (accountId && panel.accountId === accountId) score += 8
        return score
      }
      const candidates = livePanels.filter(usable).filter((panel) => (
        panel.id === preferredPanelId || !preferFreshSession || sessionStatus(panel.id) === 'waiting'
      ))
      const existing = (candidates.some(healthy) ? candidates.filter(healthy) : candidates)
        .sort((left, right) => rank(right) - rank(left) || left.id.localeCompare(right.id))[0]
      const panelId = existing?.id ?? addPanel(
        kind,
        'center',
        undefined,
        undefined,
        accountId,
        `Manager · ${taskTitle?.trim() || AI_ACCOUNT_LABELS[kind]}`,
        {
          panelRole: 'secretary',
          workspaceIsolation: 'isolated'
        }
      )
      if (panelId) {
        usedPanelIds.add(panelId)
        openedPanelIds.push(panelId)
      }
      return panelId
    }

    if (!plan) {
      const counts = new Map<CliUsageKind, number>()
      for (const kind of openKinds) counts.set(kind, (counts.get(kind) ?? 0) + 1)
      for (const [kind, count] of counts) {
        for (let index = 0; index < count; index += 1) bindPanel(kind, null, undefined, index > 0)
      }
      return { plan: null, openedPanelIds }
    }

    const assignmentKindCounts = plan.assignments.reduce((counts, assignment) => {
      counts.set(assignment.kind, (counts.get(assignment.kind) ?? 0) + 1)
      return counts
    }, new Map<CliUsageKind, number>())
    const assignments = plan.assignments.map((assignment) => ({
      ...assignment,
      panelId: bindPanel(
        assignment.kind,
        assignment.panelId,
        assignment.title,
        (assignmentKindCounts.get(assignment.kind) ?? 0) > 1
      )
    }))

    const assignedKinds = new Set(assignments.map((assignment) => assignment.kind))
    for (const kind of [...new Set(openKinds)]) {
      if (!assignedKinds.has(kind)) bindPanel(kind)
    }

    return {
      openedPanelIds,
      plan: {
        ...plan,
        assignments
      }
    }
  }

  const openSettings = (): void => {
    useDeveloperIntelligenceStore.getState().setSection('secretary')
    selectLeftSidebar(project.id, 'profile')
  }
  const openMemory = (): void => {
    selectLeftSidebar(project.id, 'memory')
  }

  const startNewSession = (): void => {
    if (chatFlightRef.current) return
    runRef.current += 1
    setThreadId(null)
    setMessages([])
    setLoading(false)
    setAnswering(false)
    setOldestMessageCursor(null)
    setHasOlderMessages(false)
    setBrief('')
    setEditingPlanMessageId(null)
    setPlanDraft(null)
    setRenamingSessionId(null)
    setPendingDeleteId(null)
    setSessionError(null)
    setToolsOpen(false)
    setWatchError(null)
    setInspectionKind(null)
  }

  const openSession = async (id: string): Promise<void> => {
    if (chatFlightRef.current) return
    const run = runRef.current
    try {
      const detail = await window.api.secretary.getThread(id)
      if (!detail || detail.thread.projectId !== project.id || run !== runRef.current) return
      runRef.current += 1
      setThreadId(detail.thread.id)
      setMessages(chatItemsFromThread(detail))
      setLoading(false)
      setAnswering(false)
      setOldestMessageCursor(detail.messages[0]
        ? { createdAt: detail.messages[0].createdAt, id: detail.messages[0].id }
        : null)
      setHasOlderMessages(detail.hasOlderMessages)
      setBrief('')
      setEditingPlanMessageId(null)
      setPlanDraft(null)
      setRenamingSessionId(null)
      setPendingDeleteId(null)
      setSessionError(null)
      setToolsOpen(false)
    } catch (cause) {
      if (run === runRef.current) setSessionError(cause instanceof Error ? cause.message : 'Could not open that session')
    }
  }

  const saveSessionTitle = async (id: string): Promise<void> => {
    try {
      await window.api.secretary.renameThread({ threadId: id, projectId: project.id, title: sessionTitle })
      setRenamingSessionId(null)
      setSessionError(null)
      setSessionsTick((value) => value + 1)
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : 'Could not rename that session')
    }
  }

  const removeSession = async (id: string): Promise<void> => {
    try {
      await window.api.secretary.deleteThread({ threadId: id, projectId: project.id })
      if (threadId === id) startNewSession()
      setPendingDeleteId(null)
      setSessionError(null)
      setSessionsTick((value) => value + 1)
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : 'Could not delete that session')
    }
  }

  const applyManagerActions = (actions: ManagerAppAction[]): void => {
    for (const action of actions) {
      if (action.startsWith('show-')) {
        const view = action.slice('show-'.length)
        if (view === 'files' || view === 'changes' || view === 'accounts' || view === 'memory' || view === 'tasks' || view === 'profile' || view === 'music' || view === 'timer') {
          selectLeftSidebar(project.id, view)
        }
        continue
      }
      if (action === 'open-terminal') addPanel('terminal')
      else if (action === 'open-browser') addPanel('browser')
      else if (action === 'open-player') addPanel('player')
      else if (action === 'open-timer') addPanel('timer')
      else if (action === 'open-ios-preview') addPanel('ios-preview')
      else if (action === 'open-android-preview') addPanel('android-preview')
      else if (action.startsWith('layout-')) {
        useWorkspaceStore.getState().setCanvasMode(action.slice('layout-'.length) as WorkspaceCanvasMode)
      }
    }
  }

  const dispatch = async (plan: SecretaryPlan, run: number, persistedRunId?: string): Promise<number> => {
    setSending(true)
    try {
      // Main-process dispatch verifies panel/project/session ownership against
      // the persisted workspace, including newly opened CLI panels.
      await flushPersistence()
      const bindings: Array<{ assignmentId: string; sessionId: string }> = []
      for (const assignment of plan.assignments) {
        if (run !== runRef.current) return 0
        if (!assignment.panelId) continue
        const ready = await waitForCliIdle(assignment.panelId)
        if (!ready) {
          throw new Error(`${AI_ACCOUNT_LABELS[assignment.kind]} is still starting. Wait for the prompt, then retry Send.`)
        }
        bindings.push({ assignmentId: assignment.id, sessionId: assignment.panelId })
      }
      if (bindings.length !== plan.assignments.length) {
        throw new Error('Every approved task needs a ready CLI session before it can start.')
      }
      // Worktree provisioning and PTY startup can update the workspace after
      // the initial flush. Persist the final panel/cwd binding before the
      // main process validates and writes the approved prompt.
      await flushPersistence()
      let sent: number
      if (persistedRunId) {
        // The main process verifies project/session ownership before changing
        // the durable approval state, so a stale or cross-project panel never
        // becomes an approved run.
        await window.api.secretary.prepareRun({
          runId: persistedRunId,
          projectId: project.id,
          assignments: bindings
        })
        await window.api.secretary.approvePlan(persistedRunId)
        const result = await window.api.secretary.dispatchRun({
          runId: persistedRunId,
          projectId: project.id,
          assignments: bindings
        })
        sent = result.dispatchedAssignmentIds.length
      } else {
        for (const assignment of plan.assignments) {
          if (!assignment.panelId) continue
          await submitCliPrompt(assignment.panelId, assignment.instruction)
        }
        sent = bindings.length
      }
      setFeedback(sent > 0 ? `Sent ${sent} prompt${sent === 1 ? '' : 's'} to CLI` : 'No CLI panel was ready')
      window.setTimeout(() => setFeedback(null), 3200)
      return sent
    } finally {
      setSending(false)
    }
  }

  const rejectPlan = async (messageId: string, persistedRunId?: string): Promise<void> => {
    if (sending) return
    try {
      if (persistedRunId) await window.api.secretary.rejectPlan(persistedRunId)
    } catch (cause) {
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: cause instanceof Error ? cause.message : 'Could not reject the plan',
          error: true
        }
      ])
      return
    }
    setMessages((current) => current.map((item) => (
      item.id === messageId && item.planStatus === 'awaiting-approval'
        ? { ...item, planStatus: 'rejected' as const }
        : item
    )))
    setFeedback('Plan rejected. No CLI was opened and no prompt was sent.')
    window.setTimeout(() => setFeedback(null), 3200)
  }

  const reviewSecretaryChanges = (panelIds: string[]): void => {
    selectLeftSidebar(project.id, 'changes')
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('bikorch:secretary-review', {
        detail: { projectId: project.id, panelIds }
      }))
    }, 80)
  }

  const startPlanRevision = (messageId: string, plan: SecretaryPlan): void => {
    if (sending || revisingPlan) return
    setEditingPlanMessageId(messageId)
    setPlanDraft({
      ...plan,
      assumptions: [...plan.assumptions],
      assignments: plan.assignments.map((assignment) => ({ ...assignment }))
    })
    setFeedback(null)
  }

  const cancelPlanRevision = (): void => {
    if (revisingPlan) return
    setEditingPlanMessageId(null)
    setPlanDraft(null)
  }

  const savePlanRevision = async (messageId: string, expectedRevision: number, persistedRunId?: string): Promise<void> => {
    if (!persistedRunId || !planDraft || revisingPlan || sending) return
    setRevisingPlan(true)
    try {
      const revised = await window.api.secretary.revisePlan({
        runId: persistedRunId,
        projectId: project.id,
        expectedRevision,
        overview: planDraft.overview,
        assignments: planDraft.assignments.map((assignment) => ({
          id: assignment.id,
          title: assignment.title,
          instruction: assignment.instruction
        })),
        panels: routingPanels,
        usage
      })
      setMessages((current) => current.map((item) => (
        item.id === messageId
          ? {
              ...item,
              plan: revised.plan,
              planRevision: revised.planRevision,
              planOpenKinds: revised.openKinds,
              planStatus: 'awaiting-approval' as const
            }
          : item
      )))
      setEditingPlanMessageId(null)
      setPlanDraft(null)
      setFeedback(`Plan revision ${revised.planRevision} saved. Review and approve when ready.`)
      window.setTimeout(() => setFeedback(null), 4200)
    } catch (cause) {
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: cause instanceof Error ? cause.message : 'Could not save the plan revision',
          error: true
        }
      ])
    } finally {
      setRevisingPlan(false)
    }
  }

  const cancelRun = async (messageId: string, persistedRunId?: string): Promise<void> => {
    if (!persistedRunId || sending || cancellingRunId) return
    setCancellingRunId(persistedRunId)
    try {
      const cancelled = await window.api.secretary.cancelRun({ runId: persistedRunId, projectId: project.id })
      const workspace = useWorkspaceStore.getState()
      for (const binding of cancelled.sessionBindings) {
        const panel = workspace.getActiveWorkspace()?.panels.find((item) => item.id === binding.sessionId)
        if (panel?.panelRole === 'secretary') workspace.removePanel(binding.sessionId)
      }
      setMessages((current) => current.map((item) => (
        item.id === messageId ? { ...item, planStatus: 'cancelled' as const } : item
      )))
      setFeedback('Stopped. The manager closed the CLIs it opened.')
      window.setTimeout(() => setFeedback(null), 4200)
    } catch (cause) {
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: cause instanceof Error ? cause.message : 'Could not cancel the Manager run',
          error: true
        }
      ])
    } finally {
      setCancellingRunId(null)
    }
  }

  const approvePlan = async (
    messageId: string,
    proposedPlan: SecretaryPlan,
    openKinds: CliUsageKind[],
    persistedRunId?: string
  ): Promise<void> => {
    if (sending || approvingPlanIdsRef.current.has(messageId)) return
    approvingPlanIdsRef.current.add(messageId)
    const run = runRef.current
    setMessages((current) => current.map((item) => (
      item.id === messageId && item.planStatus === 'awaiting-approval'
        ? { ...item, planStatus: 'dispatching' as const }
        : item
    )))

    try {
      const bound = applyWorkspaceActions(openKinds, proposedPlan)
      if (run !== runRef.current || !bound.plan) return
      presentWorkingPanels(bound.plan.assignments
        .map((assignment) => assignment.panelId)
        .filter((id): id is string => Boolean(id)))
      setMessages((current) => current.map((item) => (
        item.id === messageId
          ? { ...item, plan: bound.plan, planStatus: 'dispatching' as const }
          : item
      )))
      const sent = await dispatch(bound.plan, run, persistedRunId)
      if (run !== runRef.current) return
      const persisted = sent > 0 && persistedRunId ? await window.api.secretary.getRun(persistedRunId) : null
      setMessages((current) => current.map((item) => (
        item.id === messageId
          ? { ...item, ...(persisted ? { run: persisted, createdAt: persisted.createdAt } : {}),
              planStatus: item.planStatus === 'completed' ? 'completed' as const : sent > 0 ? 'sent' as const : 'failed' as const }
          : item
      )))
      if (sent > 0) setFeedback('CLI work is running. Manager will post the final report when it finishes.')
    } catch (cause) {
      if (run !== runRef.current) return
      if (persistedRunId) {
        try {
          const persisted = await window.api.secretary.getRun(persistedRunId)
          if (persisted?.status === 'approved') {
            await window.api.secretary.failApprovedRun(
              persistedRunId,
              cause instanceof Error ? cause.message : 'The approved plan could not be prepared for dispatch.'
            )
          }
        } catch {
          // Preserve the original dispatch error in the UI even if persistence is unavailable.
        }
      }
      setMessages((current) => [
        ...current.map((item) => (
          item.id === messageId ? { ...item, planStatus: 'failed' as const } : item
        )),
        {
          id: newId(),
          role: 'assistant',
          content: cause instanceof Error ? cause.message : 'Could not start the approved plan',
          error: true
        }
      ])
    } finally {
      approvingPlanIdsRef.current.delete(messageId)
    }
  }

  const answerRun = async (messageId: string, runId: string, assignmentId: string | undefined, answer: string): Promise<boolean> => {
    if (answering || !answer.trim()) return false
    const generation = runRef.current
    setAnswering(true)
    try {
      await window.api.secretary.answerRun({
        runId,
        projectId: project.id,
        ...(assignmentId ? { assignmentId } : {}),
        message: answer.trim()
      })
      if (generation !== runRef.current) return false
      setMessages((current) => [
        ...current.map((item) => item.id === messageId
          ? { ...item, awaitingAnswer: false }
          : item.runId === runId && item.run
            ? { ...item, run: { ...item.run, status: 'running' as const } } : item),
        { id: newId(), role: 'user', content: answer.trim(), runId }
      ])
      setFeedback('Answer sent to the waiting agent.')
      return true
    } catch (cause) {
      if (generation !== runRef.current) return false
      setMessages((current) => [...current, {
        id: newId(), role: 'assistant',
        content: cause instanceof Error ? cause.message : 'Could not send the answer to the waiting agent',
        error: true
      }])
      return false
    } finally {
      if (generation === runRef.current) setAnswering(false)
    }
  }

  const sendMessage = async (inputText?: string): Promise<void> => {
    const text = (inputText ?? brief).trim()
    if (!text || !settings.configured || loading || chatFlightRef.current) return
    chatFlightRef.current = true
    const run = runRef.current
    const history = messages
      .filter((item) => !item.error && item.content.trim())
      .map((item) => ({ role: item.role, content: item.content }))
    const userItem: ChatItem = { id: newId(), role: 'user', content: text }
    setBrief('')
    setSidebarOpen(true)
    setLoading(true)
    setFeedback(null)
    setMessages((current) => [...current, userItem])
    try {
      const response = await window.api.secretary.chat({
        project,
        message: text,
        history,
        ...(threadId ? { threadId } : {}),
        panels: routingPanels,
        usage
      })
      if (run !== runRef.current) return
      if (response.threadId) setThreadId(response.threadId)
      setSessionsTick((value) => value + 1)
      if (response.savedSkills?.length) void useDeveloperIntelligenceStore.getState().loadSkills()
      const plan = response.plan
      applyManagerActions(workspaceForRequest(response.actions ?? [], plan))
      if (!plan && response.openKinds.length > 0) {
        const opened = applyWorkspaceActions(response.openKinds, null)
        presentWorkingPanels(opened.openedPanelIds)
      }
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: response.savedSkills?.length
            ? `${response.reply}\n\nSaved: ${response.savedSkills.map((skill) => skill.name).join(', ')}.`
            : response.reply,
          ...(plan
            ? {
                plan,
                createdAt: Date.now(),
                ...(response.runId ? { runId: response.runId, planRevision: response.planRevision } : {}),
                planOpenKinds: response.openKinds ?? [],
                planStatus: 'awaiting-approval' as const
              }
            : {})
        }
      ])
      void loadSettings()
    } catch (cause) {
      if (run !== runRef.current) return
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: cause instanceof Error ? cause.message : 'Could not reach Manager',
          error: true
        }
      ])
    } finally {
      if (run === runRef.current) {
        chatFlightRef.current = false
        setLoading(false)
      }
    }
  }

  const inspectProject = async (purpose: 'project-review' | 'error-diagnosis', automatic = false): Promise<boolean> => {
    if (!settings.configured || !project.folderPath || chatFlightRef.current || loading || sending || answering || revisingPlan) return false
    chatFlightRef.current = true
    const generation = runRef.current
    const terminal = useTerminalStore.getState()
    const failures = managerFailureSignals(panels, terminal.sessions, terminal.errors, terminal.outputTails)
    const details = panels.filter((panel) => failures.some((signal) => signal.title === panel.title))
      .map((panel) => `${panel.title}: ${terminal.errors[panel.id] ?? 'A failure was detected in terminal output.'}`).slice(0, 5).join('\n')
    const text = purpose === 'error-diagnosis'
      ? `Project watch detected a failure. Analyze the current project's terminal failure evidence and relevant source files. Explain what failed, the likely cause with supporting evidence, and the smallest fix with a verification command. Separate facts from hypotheses. Report in the developer's language.\n${details}`
      : `${automatic ? 'Project watch' : 'Project review'}: inspect this project's current code, changes, instructions and terminal health. Report concrete bugs, development risks and the most useful next step, with file references. Be concise; say when the available evidence is insufficient. Do not claim to have run tests. Report in the developer's language.`
    setLoading(true)
    setInspectionKind(purpose)
    setWatchError(null)
    if (!automatic || purpose === 'error-diagnosis') setSidebarOpen(true)
    if (!automatic) setMessages((current) => [...current, { id: newId(), role: 'user', content: purpose === 'error-diagnosis' ? 'Analyze the latest error.' : 'Review this project.' }])
    try {
      const response = await window.api.secretary.chat({
        project, purpose, message: text,
        history: messages.filter((item) => !item.error).map((item) => ({ role: item.role, content: item.content })),
        ...(threadId ? { threadId } : {}), panels: routingPanels, usage
      })
      if (generation !== runRef.current) return false
      if (response.threadId) setThreadId(response.threadId)
      setMessages((current) => [...current, { id: newId(), role: 'assistant', content: response.reply, createdAt: Date.now() }])
      setSessionsTick((value) => value + 1)
      void loadSettings()
      return true
    } catch (cause) {
      if (generation !== runRef.current) return false
      const message = cause instanceof Error ? cause.message : 'Project inspection could not finish.'
      setWatchError(message)
      if (!automatic) setMessages((current) => [...current, { id: newId(), role: 'assistant', content: message, error: true }])
      return false
    } finally {
      if (generation === runRef.current) {
        chatFlightRef.current = false
        setLoading(false)
        setInspectionKind(null)
      }
    }
  }

  const projectWatch = useManagerProjectWatch({
    project, panels,
    ready: historyLoaded && settingsLoaded && settings.configured,
    busy: loading || sending || answering || revisingPlan || messages.some((item) => item.planStatus === 'sent' || item.planStatus === 'dispatching'),
    inspect: inspectProject
  })

  const waitingForUser = messages.some((item) => item.awaitingAnswer)
  const activeRuns = messages.some((item) => item.planStatus === 'sent' || item.planStatus === 'dispatching')
  const pendingApprovals = messages.filter((item) => item.planStatus === 'awaiting-approval').length
  const liveOps = cliPanels.filter((panel) => panel.status === 'busy' || panel.status === 'running' || panel.status === 'starting').length
  const railAttention = loading || waitingForUser || activeRuns || pendingApprovals > 0 || liveOps > 0 || recoveryRuns.length > 0
  const secretaryMood: SecretaryAvatarMood = answering
    ? 'working'
    : loading || revisingPlan
      ? 'thinking'
    : sending || activeRuns || liveOps > 0 || pendingApprovals > 0 || waitingForUser
      ? 'working'
      : 'idle'
  const placeholder = !settings.configured
    ? 'Manager is not connected'
    : 'Ask anything, share an error, or describe what to build…'

  const revealCli = (panelId: string): void => {
    if (!panels.some((panel) => panel.id === panelId)) {
      selectLeftSidebar(project.id, 'changes')
      return
    }
    focusWorkspacePanel(panelId)
    focusTerminal(panelId)
  }

  const composer = !settings.configured ? (
    <div className="secretary-connect-panel">
      <strong>Manager is not connected</strong>
      <p>Choose how Manager should think.</p>
      <div className="secretary-connect-actions">
        <button type="button" onClick={() => { void useSecretaryStore.getState().updateProvider({ source: 'api' }); openSettings() }}>Use API</button>
        <button type="button" onClick={() => { void useSecretaryStore.getState().updateProvider({ source: 'cli' }); openSettings() }}>Use CLI</button>
        <button type="button" onClick={openSettings}>Configure Manager</button>
      </div>
    </div>
  ) : (
    <div className="secretary-composer">
      <textarea
        aria-label="Message Manager"
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        placeholder={placeholder}
        rows={2}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void sendMessage()
          }
        }}
      />
      <button
        type="button"
        className="secretary-send"
        onClick={() => void sendMessage()}
        disabled={loading || !brief.trim() || !historyLoaded}
        aria-label="Send message"
        title="Send message"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
      </button>
    </div>
  )

  if (!open) {
    return (
      <section className="developer-secretary is-collapsed" aria-label="Manager">
        <button
          type="button"
          className={cn('secretary-rail', railAttention && 'is-attention')}
          onClick={() => setSidebarOpen(true)}
          aria-expanded={false}
          aria-label="Open Manager sidebar"
          title="Manager · Your developer workspace"
        >
          <span className="secretary-rail-mark"><AppLogo size="xs" /></span>
          {railAttention ? <i className="secretary-rail-pulse" aria-hidden /> : null}
          <span className="secretary-rail-label">Manager</span>
        </button>
      </section>
    )
  }

  return (
    <section className="developer-secretary is-open" aria-label="Manager">
      <aside className="secretary-sidebar">
        <header className="secretary-chat-header">
          <span className="secretary-chat-title">
            <SecretaryAvatar mood={secretaryMood} variant="mini" />
            <span>
              <strong>Manager</strong>
              <small>{project.name}</small>
            </span>
          </span>
          <button type="button" className="secretary-dismiss" onClick={startNewSession} disabled={loading || sending || answering} aria-label="New conversation" title="New conversation">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" className="secretary-dismiss" onClick={openSettings} aria-label="Open Manager settings" title="Manager settings">
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="secretary-dismiss" onClick={() => setSidebarOpen(false)} aria-label="Collapse Manager sidebar" title="Collapse">
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </header>
        <div className="manager-project-bar">
          <button type="button" className={cn('manager-watch-toggle', projectWatch.enabled && settings.configured && 'is-active')}
            onClick={() => projectWatch.setEnabled(!projectWatch.enabled)}
            aria-label={projectWatch.enabled ? 'Pause project watch' : 'Enable project watch'} aria-pressed={projectWatch.enabled}
            title={!settings.configured ? 'Connect Manager to inspect this project' : 'Diagnoses terminal failures. Project review runs only when you ask.'}>
            <Activity className="h-3.5 w-3.5" />
            <span>{!settings.configured ? 'Setup needed' : !project.folderPath ? 'Attach a folder' : inspectionKind === 'error-diagnosis' ? 'Analyzing error' : inspectionKind ? 'Reviewing project' : projectWatch.enabled ? 'Watching project' : 'Watch paused'}</span>
          </button>
          <button type="button" className="manager-review-button" disabled={!settings.configured || !project.folderPath || loading || !historyLoaded || sending || activeRuns}
            onClick={() => void inspectProject('project-review')} aria-label="Review project" title="Review project now">
            <ScanSearch className="h-3.5 w-3.5" /><span>Review</span>
          </button>
          <button type="button" className={cn('manager-tools-toggle', toolsOpen && 'is-open')} onClick={() => setToolsOpen(!toolsOpen)}
            aria-label="Manager tools" aria-expanded={toolsOpen} aria-controls="manager-tools">
            <SlidersHorizontal className="h-3.5 w-3.5" /><ChevronDown className="h-3 w-3" />
          </button>
        </div>
        {watchError ? <div className="manager-watch-error" role="status"><span>Inspection unavailable: {watchError}</span><button type="button" onClick={() => void inspectProject('project-review')} disabled={loading}>Retry</button></div> : null}
        {recoveryRuns.length > 0 && !toolsOpen ? <button type="button" className="manager-attention-note" onClick={() => setToolsOpen(true)}>{recoveryRuns.length} interrupted task{recoveryRuns.length === 1 ? '' : 's'} to review <ChevronDown className="h-3 w-3" /></button> : null}
        {toolsOpen ? <div className="secretary-ops manager-tools" id="manager-tools">
          <div className="manager-capabilities">
            <strong>Developer workspace</strong>
            <p>Inspect code and errors, coordinate agents, implement changes, and review results.</p>
            <span>Review runs only when you ask. Agent work starts when you approve a plan.</span>
            <small>{settings.provider.source === 'cli' ? `${settings.provider.cli.kind ? AI_ACCOUNT_LABELS[settings.provider.cli.kind] : 'CLI'} Manager` : settings.model}</small>
          </div>
          {cacheAnalysis && ((cacheAnalysis.pressured && !cacheAnalysis.dismissed) || cacheAnalysis.releasedBytes) ? (
            <div className="secretary-cache" aria-label="Cache care">
              <div className="secretary-ops-heading"><span>Cache</span></div>
              {cacheAnalysis.pressured && !cacheAnalysis.dismissed ? (
                <>
                  <p>Caches have grown and storage is tight. Development may slow down. I can optimize and tidy your storage if you want.</p>
                  <small>{cacheAnalysis.recommendation}</small>
                  {cacheAnalysis.parts.slice(0, 3).map((part) => (
                    <span key={part.id}>{part.label} · {Math.max(1, Math.round(part.bytes / (1024 * 1024)))} MB</span>
                  ))}
                  <div className="secretary-session-actions">
                    <button type="button" onClick={() => void answerCache(true)} disabled={cacheBusy}>Optimize</button>
                    <button type="button" onClick={() => void answerCache(false)} disabled={cacheBusy}>Not now</button>
                  </div>
                </>
              ) : cacheAnalysis.releasedBytes ? (
                <p>Released {Math.max(1, Math.round(cacheAnalysis.releasedBytes / (1024 * 1024)))} MB. Sign-ins and saved data were kept.</p>
              ) : null}
            </div>
          ) : null}
          <div className="secretary-memory">
            <div className="secretary-ops-heading">
              <span>Memory</span>
              <button type="button" className="secretary-memory-open" onClick={openMemory}>Edit</button>
            </div>
            {managerMemory.enabled && managerMemory.facts.length > 0 ? (
              <ul className="secretary-memory-list">
                {managerMemory.facts.map((fact) => (
                  <li key={fact.id} title={fact.content}><span>{fact.category}</span>{fact.content}</li>
                ))}
              </ul>
            ) : (
              <p className="secretary-ops-empty">
                {managerMemory.enabled
                  ? 'No memories yet. Add what Manager should know about you.'
                  : 'Memory is off, so Manager is not using what it knows about you.'}
              </p>
            )}
          </div>
          <div className="secretary-sessions">
            <div className="secretary-ops-heading">
              <span>Conversations</span>
              <button type="button" className="secretary-memory-open" onClick={startNewSession} disabled={loading}>New</button>
            </div>
            {managerSessions.filter((session) => session.id !== threadId).length === 0 ? (
              <p className="secretary-ops-empty">Your saved conversations will appear here.</p>
            ) : (
              <ul className="secretary-session-list">
                {managerSessions.filter((session) => session.id !== threadId).map((session) => (
                  <li key={session.id}>
                    {renamingSessionId === session.id ? (
                      <form
                        className="secretary-session-rename"
                        onSubmit={(event) => {
                          event.preventDefault()
                          void saveSessionTitle(session.id)
                        }}
                      >
                        <input
                          value={sessionTitle}
                          onChange={(event) => setSessionTitle(event.target.value)}
                          aria-label="Session name"
                          maxLength={160}
                        />
                        <button type="submit">Save</button>
                        <button type="button" onClick={() => setRenamingSessionId(null)}>Cancel</button>
                      </form>
                    ) : (
                      <>
                        <button type="button" className="secretary-session-open" onClick={() => void openSession(session.id)}>
                          <strong>{session.title}</strong>
                          <small>{sessionDayLabel(session.createdAt)} · {session.messageCount} message{session.messageCount === 1 ? '' : 's'}</small>
                          <span>
                            {session.work.length > 0
                              ? session.work.map((item) => sessionWorkLabel(item)).join(' · ')
                              : 'No finished work'}
                          </span>
                        </button>
                        <div className="secretary-session-actions">
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingSessionId(session.id)
                              setSessionTitle(session.title)
                              setPendingDeleteId(null)
                            }}
                          >
                            Rename
                          </button>
                          {pendingDeleteId === session.id ? (
                            <>
                              <button type="button" onClick={() => void removeSession(session.id)}>Delete</button>
                              <button type="button" onClick={() => setPendingDeleteId(null)}>Cancel</button>
                            </>
                          ) : (
                            <button type="button" onClick={() => setPendingDeleteId(session.id)}>Delete</button>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {sessionError ? <p className="secretary-ops-note">{sessionError}</p> : null}
          </div>
          <div className="secretary-ops-heading">
            <span>Operations</span>
            <strong>{cliPanels.length}</strong>
          </div>
          {cliPanels.length === 0 ? (
            <p className="secretary-ops-empty">No CLI is open yet. Chat or approve a plan to start one here.</p>
          ) : (
            <div className="secretary-ops-list">
              {cliPanels.map((panel) => (
                <button
                  key={panel.id}
                  type="button"
                  className={cn('secretary-op', operationTone(panel.status))}
                  onClick={() => revealCli(panel.id)}
                  title={`${panel.title} · ${operationLabel(panel.status)}`}
                >
                  <i aria-hidden />
                  <span>{AI_ACCOUNT_LABELS[panel.kind]}</span>
                  <small>{operationLabel(panel.status)}</small>
                </button>
              ))}
            </div>
          )}
          {pendingApprovals > 0 ? (
            <p className="secretary-ops-note">{pendingApprovals} plan{pendingApprovals === 1 ? '' : 's'} waiting for approval</p>
          ) : null}
          {recoveryRuns.length > 0 ? (
            <div className="secretary-recovery" aria-label="Interrupted Manager work">
              <strong>Recovery · {recoveryRuns.length} interrupted</strong>
              <small>Terminal sessions may still be running. Inspect them before starting a new task; prompts are never replayed automatically.</small>
              {recoveryRuns.map((run) => (
                <div className="secretary-recovery-run" key={run.id}>
                  <span>{run.requestText.slice(0, 85)}</span>
                  <div>
                    {run.sessionBindings.map((binding) => (
                      <button
                        type="button"
                        key={binding.assignmentId}
                        onClick={() => revealCli(binding.sessionId)}
                        disabled={!panels.some((panel) => panel.id === binding.sessionId)}
                        title="Inspect the original CLI terminal"
                      >
                        {run.plan?.assignments.find((item) => item.id === binding.assignmentId)?.title ?? 'CLI terminal'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div> : null}
        <div className="secretary-chat-log" ref={logRef} role="log" aria-label="Manager conversation" aria-live="polite">
          {hasOlderMessages ? (
            <button
              type="button"
              className="secretary-load-older"
              onClick={() => void loadOlderMessages()}
              disabled={loadingOlderMessages}
            >
              {loadingOlderMessages ? 'Loading earlier messages…' : 'Load earlier messages'}
            </button>
          ) : null}
          {messages.length === 0 && !loading ? (
            <div className="manager-welcome">
              <span className="manager-welcome-mark"><Code2 className="h-6 w-6" /></span>
              <span className="manager-welcome-eyebrow">YOUR DEVELOPER SPACE</span>
              <h2>Let's build something good.</h2>
              <p>One conversation to understand your code, solve errors, and move {project.name} forward.</p>
              <div className="manager-starters">
                <button type="button" onClick={() => void inspectProject('project-review')} disabled={!settings.configured || !project.folderPath || !historyLoaded}><ScanSearch className="h-4 w-4" /><span>Find what needs attention</span><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => void inspectProject('error-diagnosis')} disabled={!settings.configured || !project.folderPath || !historyLoaded}><Activity className="h-4 w-4" /><span>Help me understand an error</span><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => void sendMessage('Help me plan the next useful improvement for this project.')} disabled={!settings.configured || !historyLoaded}><Code2 className="h-4 w-4" /><span>Plan the next improvement</span><ArrowUp className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ) : null}
            <ManagerConversation
              items={messages}
              editingPlanMessageId={editingPlanMessageId}
              planDraft={planDraft}
              revisingPlan={revisingPlan}
              sending={sending}
              cancellingRunId={cancellingRunId}
              answering={answering}
              onPlanDraftChange={setPlanDraft}
              onStartPlanRevision={startPlanRevision}
              onCancelPlanRevision={cancelPlanRevision}
              onSavePlanRevision={(messageId, revision, runId) => void savePlanRevision(messageId, revision, runId)}
              onApprovePlan={(messageId, plan, kinds, runId) => void approvePlan(messageId, plan, kinds, runId)}
              onRejectPlan={(messageId, runId) => void rejectPlan(messageId, runId)}
              onCancelRun={(messageId, runId) => void cancelRun(messageId, runId)}
              onAnswerRun={answerRun}
              onOpenAgent={revealCli}
              onReviewChanges={reviewSecretaryChanges}
              onOpenAgentWork={() => selectLeftSidebar(project.id, 'changes')}
              panelStatuses={Object.fromEntries(cliPanels.map((panel) => [panel.id, panel.status]))}
            />
            {loading ? (
              <div className="secretary-bubble is-assistant is-pending">
                <SecretaryAvatar mood={answering ? 'working' : 'thinking'} variant="mini" decorative />
                <span>
                  <strong>{inspectionKind === 'error-diagnosis' ? 'Analyzing the failure' : inspectionKind ? 'Reviewing your project' : answering ? 'Forwarding answer' : 'Thinking'}</strong>
                  <small>{inspectionKind ? 'Reading code, changes, and terminal evidence…' : answering ? 'Sending your response to the correct CLI task…' : 'Working through your request…'}</small>
                </span>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </div>
            ) : null}
            {feedback ? (
              <div className="secretary-inline-message is-success">
                <Check className="h-3.5 w-3.5" /><span>{feedback}</span>
              </div>
            ) : null}
        </div>
        <div className="secretary-compose">
          {composer}
          {settings.configured ? <div className="manager-composer-note"><span>Code · agents · errors · reviews</span><span>↵ Send <span aria-hidden>·</span> ⇧↵ New line</span></div> : null}
        </div>
      </aside>
    </section>
  )
}
