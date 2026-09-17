import { useEffect, useState } from 'react'
import {
  Activity,
  CalendarClock,
  CircleDollarSign,
  KeyRound,
  Loader2,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Zap
} from 'lucide-react'
import { AppLogo } from '@renderer/components/brand/AppLogo'
import { useSecretaryStore } from '@renderer/stores/secretary-store'
import { SectionCard } from './ProfilePrimitives'

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function formatCost(value: number | null): string {
  if (value === null) return 'Unavailable'
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

function formatDate(value: number | null): string {
  if (!value) return 'No requests yet'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(value)
}

export function SecretarySettings(): React.JSX.Element {
  const settings = useSecretaryStore((state) => state.settings)
  const loaded = useSecretaryStore((state) => state.loaded)
  const loading = useSecretaryStore((state) => state.loading)
  const error = useSecretaryStore((state) => state.error)
  const load = useSecretaryStore((state) => state.load)
  const saveKey = useSecretaryStore((state) => state.saveKey)
  const clearKey = useSecretaryStore((state) => state.clearKey)
  const updateModel = useSecretaryStore((state) => state.updateModel)
  const resetUsage = useSecretaryStore((state) => state.resetUsage)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings.model)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [load, loaded])

  useEffect(() => setModel(settings.model), [settings.model])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSaved(false)
    if (apiKey.trim() && !await saveKey(apiKey.trim())) return
    if (model.trim() !== settings.model && !await updateModel(model.trim())) return
    setApiKey('')
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2400)
  }

  const disconnect = async (): Promise<void> => {
    if (!window.confirm('Disconnect Developer Secretary and remove the saved API key?')) return
    if (await clearKey()) setApiKey('')
  }

  const { usage } = settings
  const averageTokens = usage.requests > 0 ? Math.round(usage.totalTokens / usage.requests) : 0

  return (
    <div className="secretary-profile">
      <section className="secretary-profile-hero">
        <span className="secretary-profile-logo"><AppLogo size="sm" /></span>
        <div>
          <span className="secretary-profile-eyebrow">Workspace assistant</span>
          <h3>Developer Secretary</h3>
          <p>Plans work and delegates it to your open CLI agents.</p>
        </div>
        <span className={settings.configured ? 'secretary-profile-status is-ready' : 'secretary-profile-status'}>
          <i />{settings.configured ? 'Connected' : 'Not connected'}
        </span>
      </section>

      <div className="secretary-usage-grid">
        <article><Activity /><span>Requests</span><strong>{formatCount(usage.requests)}</strong></article>
        <article><Zap /><span>Total tokens</span><strong>{formatCount(usage.totalTokens)}</strong></article>
        <article><span className="secretary-usage-glyph">IN</span><span>Input</span><strong>{formatCount(usage.inputTokens)}</strong></article>
        <article><span className="secretary-usage-glyph">OUT</span><span>Output</span><strong>{formatCount(usage.outputTokens)}</strong></article>
      </div>

      <SectionCard title="Usage & cost" description="Measured from Developer Secretary API responses." className="mt-2.5">
        <div className="secretary-cost-summary">
          <div>
            <CircleDollarSign className="h-4 w-4" />
            <span>Estimated spend</span>
            <strong>{formatCost(usage.estimatedCostUsd)}</strong>
          </div>
          <dl>
            <div><dt>Cached input</dt><dd>{formatCount(usage.cachedInputTokens)}</dd></div>
            <div><dt>Average / request</dt><dd>{formatCount(averageTokens)} tokens</dd></div>
            <div><dt><CalendarClock className="h-3 w-3" /> Last request</dt><dd>{formatDate(usage.lastRequestAt)}</dd></div>
          </dl>
        </div>
        <p className="secretary-cost-note">
          Cost is an estimate for supported pricing profiles. The selected model and your OpenAI invoice remain authoritative.
        </p>
        <button
          type="button"
          className="ui-control ui-control-ghost ui-control-sm secretary-reset-usage"
          onClick={() => void resetUsage()}
          disabled={loading || usage.requests === 0}
        >
          <RotateCcw className="h-3 w-3" /> Reset usage
        </button>
      </SectionCard>

      <SectionCard title="OpenAI connection" description="Used only for planning. CLI credentials stay separate." className="mt-2.5">
        <form onSubmit={(event) => void submit(event)} className="secretary-profile-form">
          <label>
            <span><KeyRound className="h-3 w-3" /> API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.configured ? '••••••••  Saved securely — enter to replace' : 'sk-…'}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            <span>Model</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-5" spellCheck={false} />
          </label>
          <div className="secretary-security-note">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>The key is encrypted with your operating system’s secure storage and is never shown again.</span>
          </div>
          {error ? <p className="secretary-profile-error">{error}</p> : null}
          <div className="secretary-profile-actions">
            {settings.configured ? (
              <button type="button" className="ui-control ui-control-danger ui-control-sm" onClick={() => void disconnect()} disabled={loading}>
                <Trash2 className="h-3 w-3" /> Disconnect
              </button>
            ) : <span />}
            <button
              type="submit"
              className="ui-control ui-control-primary ui-control-sm"
              disabled={loading || (!apiKey.trim() && model.trim() === settings.model) || !model.trim()}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saved ? 'Saved' : 'Save changes'}
            </button>
          </div>
        </form>
      </SectionCard>
    </div>
  )
}
