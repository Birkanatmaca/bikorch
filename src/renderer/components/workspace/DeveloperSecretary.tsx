import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, Check, Loader2, ShieldCheck, SlidersHorizontal, X } from 'lucide-react'
import type { PanelDefinition, Project } from '@shared/types'
import type { SecretaryPlan } from '@shared/contracts/secretary'
import { AI_ACCOUNT_KINDS, AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import { AppLogo } from '@renderer/components/brand/AppLogo'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useSecretaryStore } from '@renderer/stores/secretary-store'
import { useUsageStore } from '@renderer/stores/usage-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

const CLI_TYPES = new Set(AI_ACCOUNT_KINDS)

export function DeveloperSecretary({ project, panels }: { project: Project; panels: PanelDefinition[] }): React.JSX.Element {
  const usage = useUsageStore((state) => state.providers)
  const sessions = useTerminalStore((state) => state.sessions)
  const selectLeftSidebar = useWorkspaceStore((state) => state.selectLeftSidebar)
  const settings = useSecretaryStore((state) => state.settings)
  const settingsLoaded = useSecretaryStore((state) => state.loaded)
  const loadSettings = useSecretaryStore((state) => state.load)
  const [brief, setBrief] = useState('')
  const [plan, setPlan] = useState<SecretaryPlan | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
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
    if (!settingsLoaded) void loadSettings()
  }, [loadSettings, settingsLoaded])

  const openSettings = (): void => {
    useDeveloperIntelligenceStore.getState().setSection('secretary')
    selectLeftSidebar(project.id, 'profile')
  }

  const createPlan = async (): Promise<void> => {
    if (!brief.trim() || !settings.configured || cliPanels.length === 0) return
    setLoading(true)
    setFeedback(null)
    setError(null)
    try {
      const nextPlan = await window.api.secretary.createPlan({ project, brief: brief.trim(), panels: cliPanels, usage })
      setPlan(nextPlan)
      void loadSettings()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare a plan')
    } finally {
      setLoading(false)
    }
  }

  const dispatch = async (): Promise<void> => {
    if (!plan) return
    setSending(true)
    setError(null)
    try {
      let sent = 0
      for (const assignment of plan.assignments) {
        if (!assignment.panelId) continue
        await window.api.pty.write({ sessionId: assignment.panelId, data: `${assignment.instruction}\r` })
        sent += 1
      }
      setPlan(null)
      setBrief('')
      setFeedback(`${sent} assignment${sent === 1 ? '' : 's'} sent`)
      window.setTimeout(() => setFeedback(null), 3200)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send one or more assignments')
    } finally {
      setSending(false)
    }
  }

  const placeholder = cliPanels.length === 0
    ? 'Open a CLI agent to start delegating…'
    : `Ask Developer Secretary to coordinate ${project.name}…`

  return (
    <section className="developer-secretary" aria-label="Developer Secretary">
      <div className="secretary-popover-stack" aria-live="polite">
        {error ? (
          <div className="secretary-inline-message is-error">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : null}
        {feedback ? (
          <div className="secretary-inline-message is-success"><Check className="h-3.5 w-3.5" /><span>{feedback}</span></div>
        ) : null}
        {plan ? (
          <div className="secretary-plan">
            <div className="secretary-plan-heading">
              <div>
                <span>Ready for your approval</span>
                <p>{plan.overview}</p>
              </div>
              <button type="button" className="secretary-dismiss" onClick={() => setPlan(null)} aria-label="Dismiss plan"><X className="h-4 w-4" /></button>
            </div>
            <div className="secretary-assignments">
              {plan.assignments.map((assignment) => (
                <article key={assignment.id}>
                  <div><span>{AI_ACCOUNT_LABELS[assignment.kind]}</span><small>{assignment.usageNote}</small></div>
                  <strong>{assignment.title}</strong>
                  <p>{assignment.instruction}</p>
                </article>
              ))}
            </div>
            <div className="secretary-plan-actions">
              <span><ShieldCheck className="h-3.5 w-3.5" /> Nothing is sent without approval</span>
              <button type="button" onClick={() => void dispatch()} disabled={sending || plan.assignments.every((item) => !item.panelId)}>
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                Approve & send
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {!settings.configured ? (
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
            disabled={cliPanels.length === 0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void createPlan()
              }
            }}
          />
          <span className="secretary-model-label">{settings.model}</span>
          <button
            type="button"
            className="secretary-send"
            onClick={() => void createPlan()}
            disabled={loading || !brief.trim() || cliPanels.length === 0}
            aria-label="Create delegation plan"
            title="Create delegation plan"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      )}
    </section>
  )
}
