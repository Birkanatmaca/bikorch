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
import { AI_ACCOUNT_KINDS, AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import {
  CLI_MANAGER_PROVIDER_UNAVAILABLE,
  MANAGER_API_STATUS_LABEL,
  MANAGER_CLI_STATUS_LABEL,
  type ManagerApiConnectionStatus,
  type ManagerCliConnectionStatus,
  type ManagerConnectionTest
} from '@shared/contracts/secretary'
import { CACHE_WARN_STEPS_MB, type CacheAnalysis } from '@shared/contracts/resources'
import type { CliUsageKind } from '@shared/contracts/usage'
import { SecretaryAvatar } from '@renderer/components/workspace/SecretaryAvatar'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
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

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
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
  const updateProvider = useSecretaryStore((state) => state.updateProvider)
  const resetUsage = useSecretaryStore((state) => state.resetUsage)
  const accounts = useAiAccountsStore((state) => state.accounts)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings.model)
  const [cliModel, setCliModel] = useState(settings.provider.cli.model ?? '')
  const [saved, setSaved] = useState(false)
  const [cache, setCache] = useState<CacheAnalysis | null>(null)
  const [apiTest, setApiTest] = useState<ManagerConnectionTest | null>(null)
  const [cliTest, setCliTest] = useState<ManagerConnectionTest | null>(null)
  const [testing, setTesting] = useState<'api' | 'cli' | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [load, loaded])

  useEffect(() => setModel(settings.model), [settings.model])
  useEffect(() => setCliModel(settings.provider.cli.model ?? ''), [settings.provider.cli.model])

  useEffect(() => {
    void window.api.resources.cacheAnalysis().then(setCache).catch(() => undefined)
  }, [])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSaved(false)
    if (apiKey.trim() && !await saveKey(apiKey.trim())) return
    if (model.trim() !== settings.model && !await updateModel(model.trim())) return
    setApiKey('')
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2400)
  }

  const testConnection = async (source: 'api' | 'cli'): Promise<void> => {
    setTesting(source)
    try {
      const result = await window.api.secretary.testConnection({ source })
      if (source === 'api') setApiTest(result)
      else setCliTest(result)
    } catch (cause) {
      const result: ManagerConnectionTest = {
        source,
        status: source === 'api' ? 'unreachable' : 'unavailable',
        message: source === 'api' ? 'Connection failed' : CLI_MANAGER_PROVIDER_UNAVAILABLE
      }
      if (cause instanceof Error && source === 'cli' && cause.message === CLI_MANAGER_PROVIDER_UNAVAILABLE) {
        result.message = cause.message
      }
      if (source === 'api') setApiTest(result)
      else setCliTest(result)
    } finally {
      setTesting(null)
    }
  }

  const disconnect = async (): Promise<void> => {
    if (!window.confirm('Disconnect Manager and remove the saved API key?')) return
    if (await clearKey()) setApiKey('')
  }

  const { usage, provider } = settings
  const averageTokens = usage.requests > 0 ? Math.round(usage.totalTokens / usage.requests) : 0
  const cliAccounts = accounts.filter((account) => provider.cli.kind && account.kind === provider.cli.kind)
  const apiStatus = apiTest
    ? MANAGER_API_STATUS_LABEL[apiTest.status as ManagerApiConnectionStatus] ?? apiTest.message
    : provider.api.statusLabel
  const cliStatus = cliTest
    ? MANAGER_CLI_STATUS_LABEL[cliTest.status as ManagerCliConnectionStatus] ?? cliTest.message
    : provider.cli.statusLabel

  return (
    <div className="secretary-profile">
      <section className="secretary-profile-hero">
        <div className="secretary-profile-copy">
          <span className="secretary-profile-eyebrow">Workspace manager</span>
          <h3>Manager</h3>
          <p>Knows you from memory and runs the CLI work from brief to result.</p>
        </div>
        <SecretaryAvatar mood="working" variant="profile" />
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

      <SectionCard title="Usage & cost" description="Measured from Manager API responses." className="mt-2.5">
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

      <SectionCard title="Cache care" description="Manager asks before clearing browser caches that grow during development." className="mt-2.5">
        <label className="secretary-cache-slider">
          <span>Ask when cache exceeds</span>
          <strong>{cache?.warnAtMb ?? 256} MB</strong>
          <input
            type="range"
            min={0}
            max={CACHE_WARN_STEPS_MB.length - 1}
            step={1}
            value={Math.max(0, CACHE_WARN_STEPS_MB.indexOf((cache?.warnAtMb ?? 256) as typeof CACHE_WARN_STEPS_MB[number]))}
            aria-label="Cache warning level"
            onChange={(event) => {
              const megabytes = CACHE_WARN_STEPS_MB[Number(event.target.value)] ?? 256
              void window.api.resources.setCacheWarn(megabytes).then((next) => {
                setCache(next)
                window.dispatchEvent(new Event('bikorch:cache-care'))
              }).catch(() => undefined)
            }}
          />
        </label>
        <p className="secretary-cost-note">
          {cache
            ? `Clearable cache is ${formatBytes(cache.clearableBytes)}. ${cache.parts[0] ? `${cache.parts[0].label} is the largest part.` : 'No cache has grown yet.'} Sign-ins, projects, and music stay.`
            : 'Measuring browser HTTP and code caches…'}
        </p>
      </SectionCard>

      <SectionCard title="AI source" description="Manager uses one source. Conversation, plans, and approvals stay the same." className="mt-2.5">
        <fieldset className="secretary-source-options">
          <legend>AI source</legend>
          <label>
            <input
              type="radio"
              name="manager-ai-source"
              checked={provider.source === 'api'}
              onChange={() => { void updateProvider({ source: 'api' }) }}
            />
            API
          </label>
          <label>
            <input
              type="radio"
              name="manager-ai-source"
              checked={provider.source === 'cli'}
              disabled={!provider.cli.generationAvailable}
              onChange={() => { void updateProvider({ source: 'cli' }) }}
            />
            CLI
          </label>
        </fieldset>
        {provider.cli.status === 'unavailable' ? <p className="secretary-cost-note">{CLI_MANAGER_PROVIDER_UNAVAILABLE}</p> : null}
      </SectionCard>

      <SectionCard title="OpenAI connection" description="Used by Manager to plan and run work. CLI credentials stay separate." className="mt-2.5">
        <form onSubmit={(event) => void submit(event)} className="secretary-profile-form">
          <label>
            <span>Provider</span>
            <select value="openai" disabled aria-label="API provider">
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label>
            <span><KeyRound className="h-3 w-3" /> API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={provider.api.hasKey ? '••••••••  Saved securely — enter to replace' : 'sk-…'}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            <span>Model</span>
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="gpt-5.6-luna"
              spellCheck={false}
            />
          </label>
          <p className="secretary-cost-note">
            This is only the Manager model. Type the identifier you want, such as gpt-5 or gpt-5.6-luna. Each CLI still uses its own account and model.
          </p>
          <div className="secretary-security-note">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>The key is encrypted with your operating system’s secure storage and is never shown again.</span>
          </div>
          <p className="secretary-source-status">Status: {apiStatus}</p>
          {error ? <p className="secretary-profile-error">{error}</p> : null}
          <div className="secretary-profile-actions">
            <button
              type="button"
              className="ui-control ui-control-ghost ui-control-sm"
              disabled={testing !== null}
              onClick={() => void testConnection('api')}
            >
              {testing === 'api' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Test connection
            </button>
            {provider.api.hasKey ? (
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

      <SectionCard title="CLI" description="Prepared for a dedicated Manager session. Coding agents keep their own sessions." className="mt-2.5">
        <form
          className="secretary-profile-form"
          onSubmit={(event) => {
            event.preventDefault()
            void updateProvider({ cli: { model: cliModel.trim() || null } })
          }}
        >
          <label>
            <span>CLI provider</span>
            <select
              aria-label="CLI provider"
              value={provider.cli.kind ?? ''}
              onChange={(event) => {
                const kind = (event.target.value || null) as CliUsageKind | null
                const stillValid = accounts.some((account) => account.id === provider.cli.accountId && account.kind === kind)
                void updateProvider({
                  cli: { kind, accountId: stillValid ? provider.cli.accountId : null }
                })
              }}
            >
              <option value="">Select a CLI</option>
              {AI_ACCOUNT_KINDS.map((kind) => (
                <option key={kind} value={kind}>{AI_ACCOUNT_LABELS[kind]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Account</span>
            <select
              aria-label="CLI account"
              value={provider.cli.accountId ?? ''}
              disabled={!provider.cli.kind}
              onChange={(event) => {
                void updateProvider({ cli: { accountId: event.target.value || null } })
              }}
            >
              <option value="">Select an account</option>
              {cliAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}{account.email ? ` · ${account.email}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Model</span>
            <input
              value={cliModel}
              onChange={(event) => setCliModel(event.target.value)}
              onBlur={() => {
                const next = cliModel.trim() || null
                if (next !== provider.cli.model) void updateProvider({ cli: { model: next } })
              }}
              placeholder="Optional"
              spellCheck={false}
              aria-label="CLI model"
            />
          </label>
          <p className="secretary-cost-note">Manager session: dedicated. It is not a coding-agent session, and it does not edit the project.</p>
          <label className="secretary-source-fallback">
            <input
              type="checkbox"
              checked={provider.fallbackToApi}
              onChange={(event) => { void updateProvider({ fallbackToApi: event.target.checked }) }}
            />
            <span>Use API if CLI provider is unavailable</span>
          </label>
          <p className="secretary-source-status">Status: {cliStatus}</p>
          <div className="secretary-profile-actions">
            <button
              type="button"
              className="ui-control ui-control-ghost ui-control-sm"
              disabled={testing !== null}
              onClick={() => void testConnection('cli')}
            >
              {testing === 'cli' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Test connection
            </button>
            <span />
          </div>
        </form>
      </SectionCard>
    </div>
  )
}
