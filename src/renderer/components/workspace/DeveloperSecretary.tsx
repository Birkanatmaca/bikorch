import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, ChevronDown, KeyRound, Loader2, Send, Settings2, ShieldCheck, Trash2, X } from 'lucide-react'
import type { PanelDefinition, Project } from '@shared/types'
import type { SecretaryPlan, SecretarySettings } from '@shared/contracts/secretary'
import { AI_ACCOUNT_KINDS, AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import { useUsageStore } from '@renderer/stores/usage-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { cn } from '@renderer/lib/utils'

const CLI_TYPES = new Set(AI_ACCOUNT_KINDS)

export function DeveloperSecretary({ project, panels }: { project: Project; panels: PanelDefinition[] }): React.JSX.Element {
  const usage = useUsageStore((state) => state.providers)
  const sessions = useTerminalStore((state) => state.sessions)
  const [settings, setSettings] = useState<SecretarySettings | null>(null)
  const [brief, setBrief] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [key, setKey] = useState('')
  const [model, setModel] = useState('gpt-5')
  const [plan, setPlan] = useState<SecretaryPlan | null>(null)
  const [lastDispatch, setLastDispatch] = useState<SecretaryPlan['assignments'] | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cliPanels = useMemo(() => panels.filter((panel) => CLI_TYPES.has(panel.type as typeof AI_ACCOUNT_KINDS[number])).map((panel) => ({
    id: panel.id,
    kind: panel.type as typeof AI_ACCOUNT_KINDS[number],
    accountId: panel.accountId,
    title: panel.title,
    status: sessions[panel.id] ?? 'stopped'
  })), [panels, sessions])

  useEffect(() => {
    void window.api.secretary.getSettings().then((next) => { setSettings(next); setModel(next.model) }).catch(() => setSettings({ configured: false, model: 'gpt-5' }))
  }, [])

  const saveKey = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setSettings(await window.api.secretary.saveKey(key))
      setKey('')
      setShowKey(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save API key')
    } finally { setLoading(false) }
  }

  const saveSettings = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.api.secretary.updateSettings({ model: model.trim() })
      setSettings(next)
      setModel(next.model)
      setShowSettings(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update Secretary settings')
    } finally { setLoading(false) }
  }

  const clearKey = async (): Promise<void> => {
    setLoading(true)
    try { setSettings(await window.api.secretary.clearKey()); setPlan(null); setLastDispatch(null) } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove API key')
    } finally { setLoading(false) }
  }

  const createPlan = async (): Promise<void> => {
    if (!brief.trim()) return
    setLoading(true)
    setError(null)
    try {
      const nextPlan = await window.api.secretary.createPlan({ project, brief: brief.trim(), panels: cliPanels, usage })
      setPlan(nextPlan)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare a plan')
    } finally { setLoading(false) }
  }

  const dispatch = async (): Promise<void> => {
    if (!plan) return
    setSending(true)
    setError(null)
    try {
      for (const assignment of plan.assignments) {
        if (!assignment.panelId) continue
        await window.api.pty.write({ sessionId: assignment.panelId, data: `${assignment.instruction}\r` })
      }
      setLastDispatch(plan.assignments)
      setPlan(null)
      setBrief('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send one or more assignments')
    } finally { setSending(false) }
  }

  return (
    <section className="developer-secretary" aria-label="Developer Secretary">
      <div className="secretary-identity"><div className="secretary-avatar"><Bot className="h-4 w-4" /></div><div><strong>Developer Secretary</strong><span>{project.name} · {cliPanels.length} CLI ready</span></div></div>
      {!settings?.configured ? (
        <button type="button" className="secretary-key-trigger" onClick={() => setShowKey((value) => !value)}><KeyRound className="h-3.5 w-3.5" /> Add OpenAI API key <ChevronDown className={cn('h-3 w-3', showKey && 'rotate-180')} /></button>
      ) : <button type="button" className="secretary-ready" onClick={() => setShowSettings((value) => !value)}><ShieldCheck className="h-3.5 w-3.5" /> {settings.model} <Settings2 className="h-3 w-3" /></button>}

      {showKey && !settings?.configured ? <div className="secretary-key-form"><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="OpenAI API key" aria-label="OpenAI API key" autoComplete="off" /><button type="button" onClick={() => void saveKey()} disabled={loading || !key.trim()}>{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save securely</button></div> : null}
      {showSettings && settings?.configured ? <div className="secretary-key-form"><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="OpenAI model identifier" aria-label="Secretary model" /><button type="button" onClick={() => void saveSettings()} disabled={loading || !model.trim()}>Save model</button><button type="button" className="secretary-danger" onClick={() => void clearKey()} disabled={loading} title="Remove API key"><Trash2 className="h-3.5 w-3.5" /></button></div> : null}

      <div className="secretary-composer"><textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Describe the project goal or work you want coordinated…" rows={1} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void createPlan() } }} /><button type="button" onClick={() => void createPlan()} disabled={loading || !brief.trim() || !settings?.configured || cliPanels.length === 0}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Plan</button></div>
      {error ? <p className="secretary-error"><X className="h-3.5 w-3.5" />{error}</p> : null}
      {!settings?.configured ? <p className="secretary-hint">The API key is encrypted by your operating system and is never exposed to the workspace or CLI panels.</p> : null}
      {settings?.configured && cliPanels.length === 0 ? <p className="secretary-hint">Open a Codex, Claude, Cursor, Gemini, or Antigravity panel to receive assignments.</p> : null}
      {plan ? <div className="secretary-plan"><div className="secretary-plan-heading"><div><span>Proposed plan · review before sending</span><p>{plan.overview}</p></div><button type="button" className="secretary-dismiss" onClick={() => setPlan(null)} aria-label="Dismiss plan"><X className="h-3.5 w-3.5" /></button></div><div className="secretary-assignments">{plan.assignments.map((assignment) => <article key={assignment.id}><span>{AI_ACCOUNT_LABELS[assignment.kind]}</span><strong>{assignment.title}</strong><p>{assignment.instruction}</p><small>{assignment.rationale} · {assignment.usageNote}</small></article>)}</div><div className="secretary-plan-actions"><span><ShieldCheck className="h-3.5 w-3.5" /> Sends only after your approval</span><button type="button" onClick={() => void dispatch()} disabled={sending || plan.assignments.every((item) => !item.panelId)}>{sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Approve & send</button></div></div> : null}
      {lastDispatch ? <div className="secretary-dispatch-status"><span><Check className="h-3.5 w-3.5" /> Last delegation</span>{lastDispatch.map((item) => <small key={item.id}>{item.title} · {item.panelId ? (sessions[item.panelId] ?? 'sent') : 'not assigned'}</small>)}</div> : null}
    </section>
  )
}
