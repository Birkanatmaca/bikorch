import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, Loader2, PanelRightClose, Pencil, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import type { PanelDefinition, Project } from '@shared/types'
import type { SecretaryMessageCursor, SecretaryPlan, SecretaryRun, SecretaryRunEvidence, SecretaryRunStatus, SecretaryThreadDetail } from '@shared/contracts/secretary'
import { AI_ACCOUNT_KINDS, AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import type { PtySessionStatus } from '@shared/contracts/pty'
import type { CliUsageKind } from '@shared/contracts/usage'
import { pickCliAccountId } from '@shared/cli-account'
import { AppLogo } from '@renderer/components/brand/AppLogo'
import { SecretaryAvatar, type SecretaryAvatarMood } from './SecretaryAvatar'
import { focusTerminal, focusWorkspacePanel } from '@renderer/lib/app-events'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useSecretaryStore } from '@renderer/stores/secretary-store'
import { useUsageStore } from '@renderer/stores/usage-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { inferCliActivity, looksWorkspaceTrustPrompt, stripAnsi } from '@renderer/lib/cli-activity'
import { submitCliPrompt } from '@renderer/lib/submit-cli-prompt'
import { flushPersistence } from '@renderer/lib/persistence-sync'
import { cn } from '@renderer/lib/utils'

const CLI_TYPES = new Set(AI_ACCOUNT_KINDS)

interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  plan?: SecretaryPlan | null
  runId?: string
  planRevision?: number
  planOpenKinds?: CliUsageKind[]
  planStatus?: 'awaiting-approval' | 'dispatching' | 'sent' | 'completed' | 'rejected' | 'cancelled' | 'failed' | 'interrupted'
  awaitingAnswer?: boolean
  awaitingAssignmentId?: string
  report?: SecretaryRunEvidence
  error?: boolean
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
const OPEN_SECRETARY_EVENT = 'bikorch:open-secretary'

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readSecretaryOpen(): boolean {
  try {
    return window.localStorage.getItem(SECRETARY_OPEN_KEY) !== '0'
  } catch {
    return true
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
    if (looksWorkspaceTrustPrompt(tail)) {
      throw new Error('The CLI is waiting for workspace trust. Review and approve it in the terminal before sending this task.')
    }
    if (inferCliActivity(tail) === 'waiting') return true
    await sleep(250)
  }
  return inferCliActivity(stripAnsi(useTerminalStore.getState().getOutputTail(sessionId))) === 'waiting'
}

export function DeveloperSecretary({ project, panels }: { project: Project; panels: PanelDefinition[] }): React.JSX.Element {
  const usage = useUsageStore((state) => state.providers)
  const sessions = useTerminalStore((state) => state.sessions)
  const selectLeftSidebar = useWorkspaceStore((state) => state.selectLeftSidebar)
  const addPanel = useWorkspaceStore((state) => state.addPanel)
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
  const [answering, setAnswering] = useState(false)
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [recoveryRuns, setRecoveryRuns] = useState<SecretaryRun[]>([])
  const [editingPlanMessageId, setEditingPlanMessageId] = useState<string | null>(null)
  const [planDraft, setPlanDraft] = useState<SecretaryPlan | null>(null)
  const [revisingPlan, setRevisingPlan] = useState(false)
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const preservedScrollRef = useRef<{ height: number; top: number } | null>(null)
  const runRef = useRef(0)
  const approvingPlanIdsRef = useRef(new Set<string>())

  const cliPanels = useMemo(() => panels.filter((panel) => CLI_TYPES.has(panel.type as typeof AI_ACCOUNT_KINDS[number])).map((panel) => ({
    id: panel.id,
    kind: panel.type as typeof AI_ACCOUNT_KINDS[number],
    accountId: panel.accountId,
    title: panel.title,
    status: sessions[panel.id] ?? 'stopped'
  })), [panels, sessions])

  useEffect(() => {
    if (!settingsLoaded) void loadSettings()
  }, [loadSettings, settingsLoaded])

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
    setSending(false)
    setAnswering(false)
    setFeedback(null)
    setThreadId(null)
    setRecoveryRuns([])
    setEditingPlanMessageId(null)
    setPlanDraft(null)
    setRevisingPlan(false)
    setCancellingRunId(null)
    approvingPlanIdsRef.current.clear()
  }, [project.id])

  useEffect(() => {
    const openSidebar = (): void => setSidebarOpen(true)
    window.addEventListener(OPEN_SECRETARY_EVENT, openSidebar)
    return () => window.removeEventListener(OPEN_SECRETARY_EVENT, openSidebar)
  }, [])

  useEffect(() => {
    const run = runRef.current
    const restoreMostRecentThread = async (): Promise<void> => {
      try {
        const [threads, runs] = await Promise.all([
          window.api.secretary.listThreads(project.id),
          window.api.secretary.listRuns(project.id)
        ])
        if (run !== runRef.current) return
        setRecoveryRuns(runs.filter((item) => item.status === 'interrupted' && item.sessionBindings.length > 0).slice(0, 3))
        const thread = threads[0]
        if (!thread) return
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
      }
    }
    void restoreMostRecentThread()
  }, [project.id])

  useEffect(() => window.api.secretary.onEvent((event) => {
    if (event.projectId !== project.id) return
    if (event.type === 'run-report') {
      setSidebarOpen(true)
      setMessages((current) => [
        ...current.map((item) => item.runId === event.runId
          ? { ...item, planStatus: 'completed' as const, awaitingAnswer: false }
          : item),
        {
          id: newId(),
          role: 'assistant',
          content: event.reply,
          report: event.evidence
        }
      ])
      setFeedback(null)
      return
    }
    if (event.type === 'run-followup') {
      setSidebarOpen(true)
      setMessages((current) => [
        ...current.map((item) => item.runId === event.completedRunId
          ? { ...item, planStatus: 'completed' as const, awaitingAnswer: false }
          : item),
        { id: newId(), role: 'assistant', content: event.reply, report: event.completedEvidence },
        {
          id: newId(),
          role: 'assistant',
          content: event.reply,
          plan: event.plan,
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
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: `${event.assignmentTitle}: ${event.message}`,
          runId: event.runId,
          awaitingAnswer: true,
          awaitingAssignmentId: event.assignmentId
        }
      ])
      setFeedback('The CLI needs input. Reply here and Secretary will forward it to the waiting session.')
      return
    }
    setMessages((current) => [
      ...current.map((item) => item.runId === event.runId
        ? { ...item, planStatus: 'failed' as const, awaitingAnswer: false }
        : item),
      { id: newId(), role: 'assistant', content: event.message, error: true }
    ])
    setFeedback(null)
  }), [project.id])

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
      throw new Error('The active project changed. Reopen this Secretary conversation before approving the plan.')
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
        !preferFreshSession || sessionStatus(panel.id) === 'waiting'
      ))
      const existing = (candidates.some(healthy) ? candidates.filter(healthy) : candidates)
        .sort((left, right) => rank(right) - rank(left) || left.id.localeCompare(right.id))[0]
      const panelId = existing?.id ?? addPanel(
        kind,
        'center',
        undefined,
        undefined,
        accountId,
        `Secretary · ${taskTitle?.trim() || AI_ACCOUNT_LABELS[kind]}`,
        {
          panelRole: 'secretary',
          workspaceIsolation: 'isolated'
        }
      )
      if (panelId) {
        usedPanelIds.add(panelId)
        if (!existing) openedPanelIds.push(panelId)
      }
      return panelId
    }

    if (!plan) {
      for (const kind of [...new Set(openKinds)]) bindPanel(kind)
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
        panels: cliPanels,
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
      await window.api.secretary.cancelRun({ runId: persistedRunId, projectId: project.id })
      setMessages((current) => current.map((item) => (
        item.id === messageId ? { ...item, planStatus: 'cancelled' as const } : item
      )))
      setFeedback('Secretary run cancelled. The CLI was interrupted if it was still active.')
      window.setTimeout(() => setFeedback(null), 4200)
    } catch (cause) {
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: cause instanceof Error ? cause.message : 'Could not cancel the Secretary run',
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
      setMessages((current) => current.map((item) => (
        item.id === messageId
          ? { ...item, plan: bound.plan, planStatus: 'dispatching' as const }
          : item
      )))
      const sent = await dispatch(bound.plan, run, persistedRunId)
      if (run !== runRef.current) return
      setMessages((current) => current.map((item) => (
        item.id === messageId
          ? { ...item, planStatus: sent > 0 ? 'sent' as const : 'failed' as const }
          : item
      )))
      if (sent > 0) setFeedback('CLI work is running. Secretary will post the final report when it finishes.')
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

  const sendMessage = async (): Promise<void> => {
    const text = brief.trim()
    if (!text || !settings.configured || loading) return
    const waitingItem = [...messages].reverse().find((item) => item.awaitingAnswer && item.runId)
    const run = ++runRef.current
    if (waitingItem?.runId) {
      const userItem: ChatItem = { id: newId(), role: 'user', content: text, runId: waitingItem.runId }
      setBrief('')
      setSidebarOpen(true)
      setLoading(true)
      setAnswering(true)
      setFeedback(null)
      setMessages((current) => [...current, userItem])
      try {
        await window.api.secretary.answerRun({
          runId: waitingItem.runId,
          projectId: project.id,
          ...(waitingItem.awaitingAssignmentId ? { assignmentId: waitingItem.awaitingAssignmentId } : {}),
          message: text
        })
        if (run !== runRef.current) return
        setMessages((current) => current.map((item) => (
          item.id === waitingItem.id ? { ...item, awaitingAnswer: false } : item
        )))
        setFeedback('Answer sent. Secretary is watching the CLI for the next result.')
      } catch (cause) {
        if (run !== runRef.current) return
        setMessages((current) => [
          ...current,
          {
            id: newId(),
            role: 'assistant',
            content: cause instanceof Error ? cause.message : 'Could not send the answer to the waiting CLI',
            error: true
          }
        ])
      } finally {
        if (run === runRef.current) {
          setLoading(false)
          setAnswering(false)
        }
      }
      return
    }
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
        panels: cliPanels,
        usage
      })
      if (run !== runRef.current) return
      if (response.threadId) setThreadId(response.threadId)
      const plan = response.plan
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: response.reply,
          ...(plan
            ? {
                plan,
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
          content: cause instanceof Error ? cause.message : 'Could not reach the secretary',
          error: true
        }
      ])
    } finally {
      if (run === runRef.current) setLoading(false)
    }
  }

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
    ? 'Connect Developer Secretary in Profile to start…'
    : waitingForUser
      ? 'Answer the waiting CLI here…'
      : `Ask Secretary about ${project.name}…`

  const revealCli = (panelId: string): void => {
    focusWorkspacePanel(panelId)
    focusTerminal(panelId)
  }

  const composer = !settings.configured ? (
    <button type="button" className="secretary-composer secretary-connect" onClick={openSettings}>
      <span className="secretary-mark"><AppLogo size="xs" /></span>
      <span>Connect Secretary in Profile to start…</span>
      <span className="secretary-settings-shortcut"><SlidersHorizontal className="h-3.5 w-3.5" /> Profile</span>
    </button>
  ) : (
    <div className="secretary-composer">
      <textarea
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        placeholder={placeholder}
        rows={2}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void sendMessage()
          }
        }}
      />
      <button
        type="button"
        className="secretary-send"
        onClick={() => void sendMessage()}
        disabled={loading || !brief.trim()}
        aria-label="Send message"
        title="Send message"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
      </button>
    </div>
  )

  if (!open) {
    return (
      <section className="developer-secretary is-collapsed" aria-label="Developer Secretary">
        <button
          type="button"
          className={cn('secretary-rail', railAttention && 'is-attention')}
          onClick={() => setSidebarOpen(true)}
          aria-expanded={false}
          aria-label="Open Secretary sidebar"
        >
          <span className="secretary-rail-mark"><AppLogo size="xs" /></span>
          {railAttention ? <i className="secretary-rail-pulse" aria-hidden /> : null}
          <span className="secretary-rail-label">Secretary</span>
        </button>
      </section>
    )
  }

  return (
    <section className="developer-secretary is-open" aria-label="Developer Secretary">
      <aside className="secretary-sidebar">
        <header className="secretary-chat-header">
          <span className="secretary-chat-title">
            <SecretaryAvatar mood={secretaryMood} variant="mini" />
            <span>
              <strong>Secretary</strong>
              <small>{project.name}</small>
            </span>
          </span>
          <span className="secretary-chat-meta" title={settings.model}>{settings.model}</span>
          <button type="button" className="secretary-dismiss" onClick={openSettings} aria-label="Open Secretary settings" title="Secretary settings">
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="secretary-dismiss" onClick={() => setSidebarOpen(false)} aria-label="Collapse Secretary sidebar" title="Collapse">
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </header>
        <div className="secretary-ops">
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
            <div className="secretary-recovery" aria-label="Interrupted Secretary work">
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
        </div>
        <div className="secretary-chat-log" ref={logRef}>
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
            <div className="secretary-empty">
              <div className="secretary-empty-stage">
                <SecretaryAvatar mood="idle" variant="hero" />
                <div className="secretary-empty-intro">
                  <span>Workspace copilot</span>
                  <strong>Ready to coordinate.</strong>
                  <p>One brief in. A clear, reviewable CLI plan out.</p>
                </div>
                <span className="secretary-empty-status"><i /> Online</span>
              </div>
              <div className="secretary-empty-copy">
                <div>
                  <strong>Start with the outcome</strong>
                  <p>Secretary plans the work, waits for your approval, then follows the live terminals through completion.</p>
                </div>
                <div className="secretary-empty-flow" aria-label="Secretary workflow">
                  <span><b>01</b> Brief</span>
                  <span><b>02</b> Approve</span>
                  <span><b>03</b> Review</span>
                </div>
              </div>
            </div>
          ) : null}
            {messages.map((item) => (
              <article
                key={item.id}
                className={cn(
                  'secretary-bubble',
                  item.role === 'user' ? 'is-user' : 'is-assistant',
                  item.error && 'is-error'
                )}
              >
                <p>{item.content}</p>
                {item.report ? (
                  <div className="secretary-report-facts secretary-run-card">
                    <div className="secretary-run-card-header">
                      <strong>Mission outcome</strong>
                      <span>{item.report.verificationLevel === 'git-observed' ? 'Git activity observed' : item.report.verificationLevel === 'cli-reported' ? 'CLI-reported' : 'Unverified signal'}</span>
                    </div>
                    <div className="secretary-run-timeline" aria-label="Task progress">
                      <span>Plan approved</span>
                      <span>CLI responded</span>
                      <span className={item.report.assignments.every((assignment) => assignment.patchCheckExitCode === 0) ? 'is-observed' : 'is-pending'}>
                        {item.report.assignments.every((assignment) => assignment.patchCheckExitCode === 0) ? 'Tracked patch check passed' : item.report.assignments.some((assignment) => assignment.patchCheckExitCode !== null && assignment.patchCheckExitCode !== 0) ? 'Tracked patch check failed' : 'Patch check unavailable'}
                      </span>
                      <span className="is-pending">Tests not run by Bikorch</span>
                    </div>
                    <div className="secretary-run-assignments">
                      {item.report.assignments.map((assignment) => {
                        const account = accounts.find((candidate) => candidate.id === assignment.accountId)
                        return (
                          <div key={assignment.assignmentId}>
                            <strong>{assignment.title}</strong>
                            <small>{AI_ACCOUNT_LABELS[assignment.kind]} · {account?.name ?? (assignment.accountId ? 'Account removed' : 'Default account')} · {assignment.completionEvidence === 'cli-reported' ? 'CLI claim' : 'Idle inferred'}</small>
                            {assignment.preexistingChangedFiles.length > 0 ? (
                              <small>{assignment.preexistingChangedFiles.length} file(s) were already changed before this assignment.</small>
                            ) : null}
                            {assignment.sessionId && panels.some((panel) => panel.id === assignment.sessionId) ? (
                              <button type="button" onClick={() => revealCli(assignment.sessionId)}>Open terminal</button>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                    <div className="secretary-completion-evidence">
                      <span>Completion signal</span>
                      <strong>
                        {item.report.assignments.filter((assignment) => assignment.completionEvidence === 'cli-reported').length} CLI-reported
                        {' · '}
                        {item.report.assignments.filter((assignment) => assignment.completionEvidence === 'terminal-idle-inferred').length} terminal-idle inferred
                      </strong>
                      <small>Git is observed independently, but task success and test/build results have not been independently verified.</small>
                    </div>
                    <div className="secretary-report-facts-heading">
                      <span>Git snapshot files (may include earlier edits)</span>
                      <strong>{item.report.changedFiles.length}</strong>
                    </div>
                    {item.report.changedFiles.length > 0 ? (
                      <ul>
                        {item.report.changedFiles.slice(0, 8).map((path) => <li key={path}>{path}</li>)}
                        {item.report.changedFiles.length > 8 ? <li>+{item.report.changedFiles.length - 8} more</li> : null}
                      </ul>
                    ) : <p className="secretary-report-empty">No new repository changes were verified.</p>}
                    {item.report.unverifiedReportedFiles.length > 0 ? (
                      <p className="secretary-report-warning">
                        CLI mentioned {item.report.unverifiedReportedFiles.length} file(s) that Git could not verify.
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="secretary-review-changes"
                      onClick={() => reviewSecretaryChanges(item.report?.assignments.map((assignment) => assignment.sessionId).filter(Boolean) ?? [])}
                    >
                      Review changes in Git
                    </button>
                  </div>
                ) : null}
                {item.plan ? (
                  <div className="secretary-plan">
                    {editingPlanMessageId === item.id && planDraft ? (
                      <div className="secretary-plan-editor">
                        <label>
                          <span>Plan overview</span>
                          <textarea
                            value={planDraft.overview}
                            rows={2}
                            onChange={(event) => setPlanDraft((current) => current ? { ...current, overview: event.target.value } : current)}
                            disabled={revisingPlan}
                          />
                        </label>
                        {planDraft.assignments.map((assignment) => (
                          <label key={assignment.id}>
                            <span>{AI_ACCOUNT_LABELS[assignment.kind]} assignment</span>
                            <input
                              value={assignment.title}
                              onChange={(event) => setPlanDraft((current) => current ? {
                                ...current,
                                assignments: current.assignments.map((entry) => entry.id === assignment.id
                                  ? { ...entry, title: event.target.value }
                                  : entry)
                              } : current)}
                              disabled={revisingPlan}
                            />
                            <textarea
                              value={assignment.instruction}
                              rows={4}
                              onChange={(event) => setPlanDraft((current) => current ? {
                                ...current,
                                assignments: current.assignments.map((entry) => entry.id === assignment.id
                                  ? { ...entry, instruction: event.target.value }
                                  : entry)
                              } : current)}
                              disabled={revisingPlan}
                            />
                          </label>
                        ))}
                        <div className="secretary-plan-actions">
                          <span>Changes are safety-checked and saved before approval.</span>
                          <button type="button" onClick={() => void savePlanRevision(item.id, item.planRevision ?? 1, item.runId)} disabled={revisingPlan || sending}>
                            {revisingPlan ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            Save revision
                          </button>
                          <button type="button" onClick={cancelPlanRevision} disabled={revisingPlan}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="secretary-plan-heading">
                          <div>
                            <span>{sending ? 'Sending to CLI' : `CLI run${item.planRevision ? ` · revision ${item.planRevision}` : ''}`}</span>
                            <p>{item.plan.overview}</p>
                            <small className="secretary-plan-topology">
                              {item.plan.assignments.length} task{item.plan.assignments.length === 1 ? '' : 's'} · {' '}
                              {item.plan.assignments.filter((assignment) => !assignment.dependsOn?.length).length} parallel root{item.plan.assignments.filter((assignment) => !assignment.dependsOn?.length).length === 1 ? '' : 's'}
                            </small>
                          </div>
                          <SecretaryAvatar mood="working" variant="card" decorative />
                        </div>
                        <div className="secretary-assignments">
                          {item.plan.assignments.map((assignment) => (
                            <article key={assignment.id}>
                              <div><span>{AI_ACCOUNT_LABELS[assignment.kind]} · {assignment.mode}</span><small>{assignment.usageNote}</small></div>
                              <strong>{assignment.title}</strong>
                              <p>{assignment.instruction}</p>
                              <small className="secretary-assignment-expected">
                                Expected: {assignment.expectedResult}
                              </small>
                              {assignment.dependsOn && assignment.dependsOn.length > 0 ? (
                                <small className="secretary-assignment-dependency">
                                  After: {assignment.dependsOn.map((dependency) => item.plan!.assignments.find((entry) => entry.id === dependency)?.title ?? dependency).join(', ')}
                                </small>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      </>
                    )}
                    {editingPlanMessageId !== item.id ? (
                    <div className="secretary-plan-actions">
                      {item.planStatus === 'awaiting-approval' ? (
                        <>
                          <span><ShieldCheck className="h-3.5 w-3.5" /> Review this plan before any CLI or prompt is started</span>
                          {item.runId ? (
                            <button type="button" onClick={() => startPlanRevision(item.id, item.plan!)} disabled={sending || revisingPlan}>
                              <Pencil className="h-3.5 w-3.5" /> Edit plan
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void approvePlan(item.id, item.plan!, item.planOpenKinds ?? [], item.runId)}
                            disabled={sending}
                          >
                            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                            Approve &amp; run
                          </button>
                          <button type="button" onClick={() => void rejectPlan(item.id, item.runId)} disabled={sending}>
                            Reject
                          </button>
                        </>
                      ) : null}
                      {item.planStatus === 'dispatching' ? (
                        <span><Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing approved CLI work…</span>
                      ) : null}
                      {item.planStatus === 'sent' ? (
                        <>
                          <span><Check className="h-3.5 w-3.5" /> Approved; prompts were sent to the CLI</span>
                          {item.runId ? (
                            <button type="button" onClick={() => void cancelRun(item.id, item.runId)} disabled={Boolean(cancellingRunId)}>
                              {cancellingRunId === item.runId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                              Cancel run
                            </button>
                          ) : null}
                        </>
                      ) : null}
                      {item.planStatus === 'completed' ? (
                        <span><Check className="h-3.5 w-3.5" /> CLI completion received; review the outcome card for verification limits.</span>
                      ) : null}
                      {item.planStatus === 'rejected' ? (
                        <span>Plan rejected; no CLI was started.</span>
                      ) : null}
                      {item.planStatus === 'cancelled' ? (
                        <span>Run cancelled; no further Secretary prompts will be sent.</span>
                      ) : null}
                      {item.planStatus === 'failed' ? (
                        <span>Run failed. Inspect its terminal and error before starting new work.</span>
                      ) : null}
                      {item.planStatus === 'interrupted' ? (
                        <span>Observation stopped when Bikorch restarted. Inspect the original CLI terminal in Recovery before doing more work.</span>
                      ) : null}
                    </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
            {loading ? (
              <div className="secretary-bubble is-assistant is-pending">
                <SecretaryAvatar mood={answering ? 'working' : 'thinking'} variant="mini" decorative />
                <span>
                  <strong>{answering ? 'Forwarding answer' : 'Thinking'}</strong>
                  <small>{answering ? 'Sending your response to the correct CLI task…' : 'Reading project context and preparing the next step…'}</small>
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
        {composer}
      </aside>
    </section>
  )
}
