import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, Loader2, Minus, ShieldCheck, SlidersHorizontal, X } from 'lucide-react'
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
import { cn } from '@renderer/lib/utils'

const CLI_TYPES = new Set(AI_ACCOUNT_KINDS)

interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  plan?: SecretaryPlan | null
  runId?: string
  planOpenKinds?: CliUsageKind[]
  planStatus?: 'awaiting-approval' | 'dispatching' | 'sent' | 'rejected' | 'failed'
  error?: boolean
}

function planStatusForRun(status: SecretaryRunStatus): ChatItem['planStatus'] {
  if (status === 'awaiting-approval') return 'awaiting-approval'
  if (status === 'rejected') return 'rejected'
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'failed'
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
            ...(run ? { runId: run.id, planOpenKinds: run.openKinds, planStatus: planStatusForRun(run.status) } : {})
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
        { id: newId(), role: 'assistant', content: event.reply }
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
      if (persistedRunId) await window.api.secretary.approvePlan(persistedRunId)
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
                ...(response.runId ? { runId: response.runId } : {}),
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
                {item.plan ? (
                  <div className="secretary-plan">
                    <div className="secretary-plan-heading">
                      <div>
                        <span>{sending ? 'Sending to CLI' : 'CLI run'}</span>
                        <p>{item.plan.overview}</p>
                      </div>
                    </div>
                    <div className="secretary-assignments">
                      {item.plan.assignments.map((assignment) => (
                        <article key={assignment.id}>
                          <div><span>{AI_ACCOUNT_LABELS[assignment.kind]}</span><small>{assignment.usageNote}</small></div>
                          <strong>{assignment.title}</strong>
                          <p>{assignment.instruction}</p>
                        </article>
                      ))}
                    </div>
                    <div className="secretary-plan-actions">
                      {item.planStatus === 'awaiting-approval' ? (
                        <>
                          <span><ShieldCheck className="h-3.5 w-3.5" /> Review this plan before any CLI or prompt is started</span>
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
                        <span><Check className="h-3.5 w-3.5" /> Approved; prompts were sent to the CLI</span>
                      ) : null}
                      {item.planStatus === 'rejected' ? (
                        <span>Plan rejected; no CLI was started.</span>
                      ) : null}
                      {item.planStatus === 'failed' ? (
                        <span>Plan did not start. Create a fresh plan after resolving the issue.</span>
                      ) : null}
                    </div>
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
