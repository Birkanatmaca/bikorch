import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, Loader2, Minus, ShieldCheck, SlidersHorizontal, X } from 'lucide-react'
import type { PanelDefinition, Project } from '@shared/types'
import type { SecretaryPlan } from '@shared/contracts/secretary'
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
import { inferCliActivity, looksWorkspaceTrustPrompt, stripAnsi, TRUST_ACCEPT_SEQUENCE } from '@renderer/lib/cli-activity'
import { cn } from '@renderer/lib/utils'

const CLI_TYPES = new Set(AI_ACCOUNT_KINDS)

interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  plan?: SecretaryPlan | null
  error?: boolean
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
      await window.api.pty.write({ sessionId, data: TRUST_ACCEPT_SEQUENCE })
      await sleep(900)
      continue
    }
    if (inferCliActivity(tail) === 'waiting') return true
    await sleep(250)
  }
  return inferCliActivity(stripAnsi(useTerminalStore.getState().getOutputTail(sessionId))) === 'waiting'
}

async function waitForCliIdleAfterWork(sessionId: string, timeoutMs = 240000): Promise<boolean> {
  const started = Date.now()
  let sawBusy = false
  while (Date.now() - started < timeoutMs) {
    const status = useTerminalStore.getState().getStatus(sessionId)
    if (status === 'error' || status === 'stopped') return false
    if (status === 'busy') sawBusy = true
    if (sawBusy && status === 'waiting') return true
    await sleep(400)
  }
  return false
}

function fallbackPlan(
  instruction: string,
  kinds: CliUsageKind[],
  opened: Map<CliUsageKind, string>
): SecretaryPlan | null {
  if (kinds.length === 0) return null
  return {
    overview: 'Sending the request to the CLI.',
    assumptions: [],
    assignments: kinds.map((kind, index) => ({
      id: `assignment-${index + 1}`,
      panelId: opened.get(kind) ?? null,
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
  const logRef = useRef<HTMLDivElement>(null)
  const runRef = useRef(0)

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
  }, [project.id])

  useEffect(() => {
    const node = logRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, loading, open])

  const applyWorkspaceActions = (openKinds: CliUsageKind[], plan: SecretaryPlan | null): {
    plan: SecretaryPlan | null
    opened: Map<CliUsageKind, string>
  } => {
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

  const dispatch = async (plan: SecretaryPlan, run: number): Promise<number> => {
    setSending(true)
    try {
      let sent = 0
      for (const assignment of plan.assignments) {
        if (run !== runRef.current) return sent
        if (!assignment.panelId) continue
        const ready = await waitForCliIdle(assignment.panelId)
        if (!ready) {
          throw new Error(`${AI_ACCOUNT_LABELS[assignment.kind]} is still starting. Wait for the prompt, then retry Send.`)
        }
        await window.api.pty.write({ sessionId: assignment.panelId, data: `${assignment.instruction}\r` })
        sent += 1
      }
      setFeedback(sent > 0 ? `Sent ${sent} prompt${sent === 1 ? '' : 's'} to CLI` : 'No CLI panel was ready')
      window.setTimeout(() => setFeedback(null), 3200)
      return sent
    } catch (cause) {
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: cause instanceof Error ? cause.message : 'Could not send one or more assignments',
          error: true
        }
      ])
      return 0
    } finally {
      setSending(false)
    }
  }

  const continueFromCli = async (plan: SecretaryPlan, run: number): Promise<void> => {
    const targets = plan.assignments.filter((assignment) => assignment.panelId)
    if (targets.length === 0) return
    setFeedback('Waiting for CLI analysis…')
    const finished = await Promise.all(targets.map((assignment) => waitForCliIdleAfterWork(assignment.panelId!)))
    if (run !== runRef.current) return
    if (!finished.some(Boolean)) {
      setFeedback(null)
      return
    }
    const tails = targets
      .map((assignment) => {
        const raw = stripAnsi(useTerminalStore.getState().getOutputTail(assignment.panelId!)).slice(-3500)
        return `## ${AI_ACCOUNT_LABELS[assignment.kind]}\n${raw}`
      })
      .join('\n\n')
    const livePanels = useWorkspaceStore.getState().getActiveWorkspace()?.panels ?? panels
    const nextPanels = livePanels
      .filter((panel) => CLI_TYPES.has(panel.type as typeof AI_ACCOUNT_KINDS[number]))
      .map((panel) => ({
        id: panel.id,
        kind: panel.type as typeof AI_ACCOUNT_KINDS[number],
        accountId: panel.accountId,
        title: panel.title,
        status: useTerminalStore.getState().getStatus(panel.id) ?? 'stopped'
      }))
    const history = [
      ...messages
        .filter((item) => !item.error && item.content.trim())
        .map((item) => ({ role: item.role, content: item.content })),
      {
        role: 'user' as const,
        content: `The CLI finished. Terminal tail:\n${tails}\n\nIf it listed gaps, return a plan with up to 3 concrete implementation prompts. If the work is done, plan null and summarize.`
      }
    ]
    try {
      const response = await window.api.secretary.chat({
        project,
        message: history.at(-1)!.content,
        history: history.slice(0, -1),
        panels: nextPanels,
        usage: useUsageStore.getState().providers
      })
      if (run !== runRef.current) return
      const bound = applyWorkspaceActions(response.openKinds ?? [], response.plan)
      const nextPlan = bound.plan
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: response.reply,
          ...(nextPlan ? { plan: nextPlan } : {})
        }
      ])
      if (nextPlan?.assignments.some((assignment) => assignment.panelId)) {
        await dispatch(nextPlan, run)
      }
    } catch (cause) {
      if (run !== runRef.current) return
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: cause instanceof Error ? cause.message : 'Could not continue from the CLI report',
          error: true
        }
      ])
    } finally {
      if (run === runRef.current) setFeedback(null)
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
        panels: cliPanels,
        usage
      })
      if (run !== runRef.current) return
      const bound = applyWorkspaceActions(response.openKinds ?? [], response.plan)
      const plan = bound.plan ?? fallbackPlan(text, response.openKinds ?? [], bound.opened)
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: response.reply,
          ...(plan ? { plan } : {})
        }
      ])
      void loadSettings()
      if (plan?.assignments.some((assignment) => assignment.panelId)) {
        const sent = await dispatch(plan, run)
        if (sent > 0 && run === runRef.current) void continueFromCli(plan, run)
      }
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
                      <span><ShieldCheck className="h-3.5 w-3.5" /> Trust is skipped; prompt is typed when the CLI is idle</span>
                      <button
                        type="button"
                        onClick={() => void dispatch(item.plan!, runRef.current)}
                        disabled={sending || item.plan.assignments.every((assignment) => !assignment.panelId)}
                      >
                        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                        Send again
                      </button>
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
