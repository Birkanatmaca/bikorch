import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, KeyRound, LoaderCircle, Plus, Terminal, Trash2, X, XCircle } from 'lucide-react'
import {
  API_KEY_PROVIDERS,
  API_KEY_PROVIDER_CLI,
  API_KEY_PROVIDER_LABELS,
  MANAGER_API_KEY_PROVIDERS,
  looksLikeProviderKey,
  type ApiKeyProvider,
  type ApiKeyRecord
} from '@shared/contracts/api-keys'
import { AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import { useApiKeysStore } from '@renderer/stores/api-keys-store'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { Button } from '@renderer/components/ui/Button'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { cn } from '@renderer/lib/utils'

const KEY_PLACEHOLDER: Record<ApiKeyProvider, string> = {
  anthropic: 'sk-ant-api03-…',
  openai: 'sk-proj-…',
  gemini: 'AIza…'
}

function AddKeyForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const add = useApiKeysStore((state) => state.add)
  const [provider, setProvider] = useState<ApiKeyProvider>('anthropic')
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [useForManager, setUseForManager] = useState(false)
  const [busy, setBusy] = useState(false)
  const managerAllowed = MANAGER_API_KEY_PROVIDERS.includes(provider)
  const shapeOk = !secret.trim() || looksLikeProviderKey(provider, secret)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    const ok = await add({
      provider,
      label: label || `${API_KEY_PROVIDER_LABELS[provider]} key`,
      secret,
      useForManager: managerAllowed && useForManager
    })
    setBusy(false)
    if (ok) {
      setSecret('')
      onDone()
    }
  }

  return (
    <form className="api-key-form" onSubmit={(event) => void submit(event)}>
      <div className="api-key-form-row">
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value as ApiKeyProvider)}
          aria-label="Provider"
          className="api-key-input"
        >
          {API_KEY_PROVIDERS.map((item) => (
            <option key={item} value={item}>
              {API_KEY_PROVIDER_LABELS[item]}
            </option>
          ))}
        </select>
        <input
          className="api-key-input flex-1"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Name, e.g. Work project"
          maxLength={80}
          aria-label="Key name"
        />
      </div>
      <input
        className={cn('api-key-input w-full font-mono', !shapeOk && 'is-invalid')}
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
        placeholder={KEY_PLACEHOLDER[provider]}
        type="password"
        autoComplete="off"
        spellCheck={false}
        aria-label="API key"
      />
      {!shapeOk && (
        <p className="api-key-form-hint is-error">This does not look like a {API_KEY_PROVIDER_LABELS[provider]} key.</p>
      )}
      <label className={cn('api-key-check', !managerAllowed && 'is-disabled')}>
        <input
          type="checkbox"
          checked={managerAllowed && useForManager}
          disabled={!managerAllowed}
          onChange={(event) => setUseForManager(event.target.checked)}
        />
        Use for Manager
        {!managerAllowed && <span className="api-key-form-hint">· the Manager runs on OpenAI</span>}
      </label>
      <p className="api-key-form-hint">
        Stored encrypted with your system keychain. Bikorch never shows the full key again.
      </p>
      <div className="api-key-form-actions">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={busy || !secret.trim() || !shapeOk}>
          {busy ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : null}
          Save key
        </Button>
      </div>
    </form>
  )
}

function KeyRow({ record }: { record: ApiKeyRecord }): React.JSX.Element {
  const testing = useApiKeysStore((state) => state.testingIds[record.id] === true)
  const testError = useApiKeysStore((state) => state.testErrors[record.id])
  const accounts = useAiAccountsStore((state) => state.accounts)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const usedBy = useMemo(() => accounts.filter((account) => account.apiKeyId === record.id), [accounts, record.id])
  const managerAllowed = MANAGER_API_KEY_PROVIDERS.includes(record.provider)
  const cli = API_KEY_PROVIDER_CLI[record.provider]

  const connect = async (): Promise<void> => {
    setConnecting(true)
    await useApiKeysStore.getState().connectCli(record.id)
    setConnecting(false)
  }

  return (
    <li className="api-key-row">
      <div className="api-key-main">
        <KeyRound className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
        <div className="api-key-text">
          <span className="api-key-name">{record.label}</span>
          <span className="api-key-meta">
            {API_KEY_PROVIDER_LABELS[record.provider]} · ••••{record.hint}
            {record.lastTestOk === true && !testError && (
              <span className="api-key-ok">
                <CheckCircle2 className="h-3 w-3" aria-hidden /> works
              </span>
            )}
            {(record.lastTestOk === false || testError) && (
              <span className="api-key-bad">
                <XCircle className="h-3 w-3" aria-hidden /> failed
              </span>
            )}
          </span>
        </div>
        <Button size="sm" variant="ghost" disabled={testing} onClick={() => void useApiKeysStore.getState().test(record.id)}>
          {testing ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : null}
          Test
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Remove key"
          aria-label={`Remove ${record.label}`}
          onClick={() => setConfirmRemove(true)}
        >
          <Trash2 className="h-3 w-3" aria-hidden />
        </Button>
      </div>

      <div className="api-key-uses">
        <label className={cn('api-key-check', !managerAllowed && 'is-disabled')} title={managerAllowed ? '' : 'The Manager runs on OpenAI'}>
          <input
            type="checkbox"
            checked={record.useForManager}
            disabled={!managerAllowed}
            onChange={(event) => void useApiKeysStore.getState().setManager(event.target.checked ? record.id : null)}
          />
          Use for Manager
        </label>
        <Button size="sm" variant="secondary" disabled={connecting} onClick={() => void connect()}>
          {connecting ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : <Terminal className="h-3 w-3" aria-hidden />}
          Use with {AI_ACCOUNT_LABELS[cli]}
        </Button>
      </div>
      {usedBy.length > 0 && (
        <p className="api-key-used-by">
          Signed in: {usedBy.map((account) => `${AI_ACCOUNT_LABELS[account.kind]} · ${account.name}`).join(', ')}
        </p>
      )}
      {testError && <p className="api-key-form-hint is-error">{testError}</p>}

      {confirmRemove && (
        <ConfirmDialog
          title={`Remove ${record.label}?`}
          message={
            usedBy.length || record.useForManager
              ? `It is in use${record.useForManager ? ' by the Manager' : ''}${usedBy.length ? `${record.useForManager ? ' and' : ''} by ${usedBy.length} CLI account(s)` : ''}. They stop working until you add a key again. The key itself is not revoked at the provider.`
              : 'Bikorch forgets this key. It is not revoked at the provider.'
          }
          confirmLabel="Remove"
          onConfirm={() => {
            setConfirmRemove(false)
            void useApiKeysStore.getState().remove(record.id)
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </li>
  )
}

/** Vault of provider API keys: add, test, remove, and choose where each key is used. */
export function ApiKeysPanel({
  compact = false,
  embedded = false
}: {
  compact?: boolean
  /** Inside a sidebar that already shows a title: drop the card frame and heading. */
  embedded?: boolean
}): React.JSX.Element {
  const keys = useApiKeysStore((state) => state.keys)
  const loaded = useApiKeysStore((state) => state.loaded)
  const error = useApiKeysStore((state) => state.error)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void useApiKeysStore.getState().load()
  }, [])

  return (
    <section className={cn('agent-setup api-keys', compact && 'is-compact', embedded && 'is-embedded')} aria-labelledby="api-keys-title">
      <div className="agent-setup-head">
        <h2 id="api-keys-title" className={cn('agent-setup-title', embedded && 'sr-only')}>
          API keys
        </h2>
        <span className="agent-setup-count">
          {keys.length === 0 ? 'Use a provider key instead of a subscription login' : `${keys.length} saved`}
        </span>
        {!adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3" aria-hidden /> Add key
          </Button>
        )}
      </div>
      {error && (
        <div className="agent-setup-error mx-3 mt-2" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => useApiKeysStore.getState().clearError()}>
            <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      )}
      {adding && <AddKeyForm onDone={() => setAdding(false)} />}
      {loaded && keys.length > 0 && (
        <ul className="agent-setup-list">
          {keys.map((record) => (
            <KeyRow key={record.id} record={record} />
          ))}
        </ul>
      )}
    </section>
  )
}
