import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, Loader2, Minus, Pencil, Save, ShieldCheck, SlidersHorizontal, X } from 'lucide-react'
import type { PanelDefinition, Project } from '@shared/types'
import type { SecretaryPlan, SecretaryRunStatus, SecretaryThreadDetail } from '@shared/contracts/secretary'
import { AI_ACCOUNT_KINDS, AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import type { CliUsageKind } from '@shared/contracts/usage'
import { pickCliAccountId } from '@shared/cli-account'
import { AppLogo } from '@renderer/components/brand/AppLogo'
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
  planStatus?: 'awaiting-approval' | 'dispatching' | 'sent' | 'rejected' | 'cancelled' | 'failed'
  report?: {
    changedFiles: string[]
    unverifiedReportedFiles: string[]
    panelIds: string[]
  }
  error?: boolean
}

function planStatusForRun(status: SecretaryRunStatus): ChatItem['planStatus'] {
  if (status === 'awaiting-approval') return 'awaiting-approval'
  if (status === 'rejected') return 'rejected'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'failed' || status === 'interrupted') return 'failed'
  return 'sent'
}

function chatItemsFromThread(detail: SecretaryThreadDetail): ChatItem[] {
  const runs = new Map(detail.runs.map((run) => [run.id, run]))
  return detail.messages.map((message) => {
    const run = message.runId ? runs.get(message.runId) : undefined
    const plan = message.role === 'assistant' && message.type === 'chat' ? run?.plan ?? null : null
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
      error: message.type === 'error'
    }
  })
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function waitForCliIdle(sessionId: string, timeoutMs = 60000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = useTerminalStore.getState().getStatus(sessionId)
    if (status === 'error' || status === 'stopped') return false
    const tail = stripAnsi(useTerminalStore.getState().getOutputTail(sessionId))
    if (looksWorkspaceTrustPrompt(tail)) {
      throw new Error('The CLI is waiting for workspace trust. Review and approve it in the terminal before sending this task.')
    }
    if (inferCliActivity(tail) === 'waiting') return true
    await sleep(250)
  }
  return inferCliActivity(stripAnsi(useTerminalStore.getState().getOutputTail(sessionId))) === 'waiting'
}

function fallbackPlan(
  instruction: string,
  kinds: CliUsageKind[]
): SecretaryPlan | null {
  if (kinds.length === 0) return null
  return {
    overview: 'Sending the request to the CLI.',
    assumptions: [],
    assignments: kinds.map((kind, index) => ({
      id: `assignment-${index + 1}`,
      panelId: null,
      kind,
      title: `${AI_ACCOUNT_LABELS[kind]} task`,
      instruction,
      rationale: 'You asked this CLI to do the work.',
      usageNote: 'Using the account with remaining usage.'
    })),
    approvalRequired: true
  }
}

export function DeveloperSecretary({ project, panels }: { project: Project; panels: PanelDefinition[] }): React.JSX.Element {
  const usage = useUsageStore((state) => state.providers)
  const sessions = useTerminalStore((state) => state.sessions)
  const selectLeftSidebar = useWorkspaceStore((state) => state.selectLeftSidebar)
  const addPanel = useWorkspaceStore((state) => state.addPanel)
  const settings = useSecretaryStore((state) => state.settings)
  const settingsLoaded = useSecretaryStore((state) => state.loaded)
  const loadSettings = useSecretaryStore((state) => state.load)
  const [brief, setBrief] = useState('')
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [open, setOpen] = useState(false)
  const [docked, setDocked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [editingPlanMessageId, setEditingPlanMessageId] = useState<string | null>(null)
  const [planDraft, setPlanDraft] = useState<SecretaryPlan | null>(null)
  const [revisingPlan, setRevisingPlan] = useState(false)
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    runRef.current += 1
    setMessages([])
    setOpen(false)
    setDocked(false)
    setBrief('')
    setFeedback(null)
    setThreadId(null)
    setEditingPlanMessageId(null)
    setPlanDraft(null)
    setRevisingPlan(false)
    setCancellingRunId(null)
    approvingPlanIdsRef.current.clear()
  }, [project.id])

  useEffect(() => {
    const run = runRef.current
    const restoreMostRecentThread = async (): Promise<void> => {
      try {
        const threads = await window.api.secretary.listThreads(project.id)
        const thread = threads[0]
        if (!thread) return
        const detail = await window.api.secretary.getThread(thread.id)
        if (!detail || run !== runRef.current) return
        setThreadId(detail.thread.id)
        setMessages(chatItemsFromThread(detail))
      } catch {
        // Secretary remains usable without local conversation history.
      }
    }
    void restoreMostRecentThread()
  }, [project.id])

  useEffect(() => window.api.secretary.onEvent((event) => {
    if (event.projectId !== project.id) return
    if (event.type === 'run-report') {
      setMessages((current) => [
        ...current.map((item) => item.runId === event.runId ? { ...item, planStatus: 'sent' as const } : item),
        {
          id: newId(),
          role: 'assistant',
          content: event.reply,
          report: {
            changedFiles: event.changedFiles,
            unverifiedReportedFiles: event.unverifiedReportedFiles,
            panelIds: event.panelIds
          }
        }
      ])
      setFeedback(null)
      return
    }
    if (event.type === 'run-followup') {
      setMessages((current) => [
        ...current.map((item) => item.runId === event.completedRunId ? { ...item, planStatus: 'sent' as const } : item),
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
      setMessages((current) => [
        ...current,
        { id: newId(), role: 'assistant', content: event.message }
      ])
      setFeedback('Secretary is waiting for your answer in the CLI terminal.')
      return
    }
    setMessages((current) => [
      ...current.map((item) => item.runId === event.runId ? { ...item, planStatus: 'failed' as const } : item),
      { id: newId(), role: 'assistant', content: event.message, error: true }
    ])
    setFeedback(null)
  }), [project.id])

  useEffect(() => {
    const node = logRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, loading, open])

  const applyWorkspaceActions = (openKinds: CliUsageKind[], plan: SecretaryPlan | null): {
    plan: SecretaryPlan | null
    opened: Map<CliUsageKind, string>
  } => {
    if (useWorkspaceStore.getState().activeProjectId !== project.id) {
      throw new Error('The active project changed. Reopen this Secretary conversation before approving the plan.')
    }
    const kinds = [...openKinds]
    if (plan) {
      for (const assignment of plan.assignments) {
        if (!assignment.panelId && !kinds.includes(assignment.kind)) kinds.push(assignment.kind)
      }
    }
    const opened = new Map<CliUsageKind, string>()
    const livePanels = useWorkspaceStore.getState().getActiveWorkspace()?.panels ?? panels
    const accounts = useAiAccountsStore.getState().accounts
    const activeByKind = useAiAccountsStore.getState().activeAccountByKind
    for (const kind of kinds) {
      const accountId = pickCliAccountId(kind, accounts, usage, activeByKind[kind])
      const existing = livePanels.find((panel) =>
        panel.type === kind && (!accountId || panel.accountId === accountId)
      )
      const panelId = existing?.id || addPanel(kind, 'center', undefined, undefined, accountId)
      if (panelId) opened.set(kind, panelId)
    }
    if (!plan) return { plan: null, opened }
    return {
      opened,
      plan: {
        ...plan,
        assignments: plan.assignments.map((assignment) => ({
          ...assignment,
          panelId: assignment.panelId && livePanels.some((panel) => panel.id === assignment.panelId)
            ? assignment.panelId
            : opened.get(assignment.kind) ?? assignment.panelId
        }))
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
    const run = ++runRef.current
    const history = messages
      .filter((item) => !item.error && item.content.trim())
      .map((item) => ({ role: item.role, content: item.content }))
    const userItem: ChatItem = { id: newId(), role: 'user', content: text }
    setBrief('')
    setOpen(true)
    setDocked(true)
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
      const plan = response.plan ?? fallbackPlan(text, response.openKinds ?? [])
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

  const placeholder = !settings.configured
    ? 'Connect Developer Secretary in Profile to start…'
    : `Chat with Secretary about ${project.name}…`

  const composer = !settings.configured ? (
    <button type="button" className="secretary-composer secretary-connect" onClick={openSettings}>
      <span className="secretary-mark"><AppLogo size="xs" /></span>
      <span>Connect Developer Secretary in Profile to start…</span>
      <span className="secretary-settings-shortcut"><SlidersHorizontal className="h-3.5 w-3.5" /> Profile</span>
    </button>
  ) : (
    <div className="secretary-composer">
      <button type="button" className="secretary-mark" onClick={openSettings} title="Open Secretary settings" aria-label="Open Secretary settings">
        <AppLogo size="xs" />
      </button>
      <textarea
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        placeholder={placeholder}
        rows={1}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void sendMessage()
          }
        }}
      />
      <span className="secretary-model-label">{settings.model}</span>
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

  return (
    <section
      className={cn('developer-secretary', docked && 'is-docked', open && 'is-open')}
      aria-label="Developer Secretary"
    >
      {docked ? (
        <div className="secretary-chat">
          <header className="secretary-chat-header">
            <span className="secretary-chat-title">
              <AppLogo size="xs" />
              Secretary
            </span>
            <span className="secretary-chat-meta">{settings.model}</span>
            <button type="button" className="secretary-dismiss" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Collapse chat' : 'Expand chat'}>
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="secretary-dismiss"
              onClick={() => { runRef.current += 1; setOpen(false); setDocked(false); setMessages([]) }}
              aria-label="Close chat"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </header>
          <div className="secretary-chat-log" ref={logRef}>
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
                  <div className="secretary-report-facts">
                    <div className="secretary-report-facts-heading">
                      <span>Verified Git changes</span>
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
                      onClick={() => reviewSecretaryChanges(item.report?.panelIds ?? [])}
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
                          </div>
                        </div>
                        <div className="secretary-assignments">
                          {item.plan.assignments.map((assignment) => (
                            <article key={assignment.id}>
                              <div><span>{AI_ACCOUNT_LABELS[assignment.kind]}</span><small>{assignment.usageNote}</small></div>
                              <strong>{assignment.title}</strong>
                              <p>{assignment.instruction}</p>
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
                      {item.planStatus === 'rejected' ? (
                        <span>Plan rejected; no CLI was started.</span>
                      ) : null}
                      {item.planStatus === 'cancelled' ? (
                        <span>Run cancelled; no further Secretary prompts will be sent.</span>
                      ) : null}
                      {item.planStatus === 'failed' ? (
                        <span>Plan did not start. Create a fresh plan after resolving the issue.</span>
                      ) : null}
                    </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
            {loading ? (
              <div className="secretary-bubble is-assistant is-pending">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Thinking…</span>
              </div>
            ) : null}
            {feedback ? (
              <div className="secretary-inline-message is-success">
                <Check className="h-3.5 w-3.5" /><span>{feedback}</span>
              </div>
            ) : null}
          </div>
          {composer}
        </div>
      ) : composer}
    </section>
  )
}
