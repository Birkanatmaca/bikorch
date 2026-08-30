import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  UsersRound,
  X
} from 'lucide-react'
import {
  AI_ACCOUNT_KINDS,
  AI_ACCOUNT_LABELS,
  type AiAccount
} from '@shared/contracts/accounts'
import type { CliUsageInfo, CliUsageKind, CliUsageResponse } from '@shared/contracts/usage'
import { CLI_LOGO_CLASS, getCliLogo } from '@renderer/lib/cli-logos'
import {
  type AiAccountDraft,
  useAiAccountsStore
} from '@renderer/stores/ai-accounts-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import {
  AI_ACCOUNTS_REFRESH_EVENT,
  AI_ACCOUNT_AUTHENTICATED_EVENT
} from '@renderer/lib/app-events'
import { cn } from '@renderer/lib/utils'

const EMPTY_DRAFT: AiAccountDraft = {
  kind: 'claude',
  name: '',
  email: '',
  plan: '',
  note: ''
}

function usageColor(remaining: number): string {
  if (remaining <= 10) return '#f05d68'
  if (remaining <= 30) return '#f2b84b'
  return '#3ccb7f'
}

function CircularUsage({
  label,
  remaining,
  detail
}: {
  label: string
  remaining: number | null
  detail?: string
}): React.JSX.Element {
  const safeRemaining = remaining === null ? 0 : Math.max(0, Math.min(100, remaining))
  const color = remaining === null ? '#707986' : usageColor(safeRemaining)
  const background =
    remaining === null
      ? 'conic-gradient(#272c35 0deg, #272c35 360deg)'
      : `conic-gradient(${color} ${safeRemaining * 3.6}deg, #272c35 ${safeRemaining * 3.6}deg 360deg)`

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-app-bg/60 p-1.5">
      <div
        className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
        style={{ background }}
        aria-label={remaining === null ? `${label}: unavailable` : `${label}: ${Math.round(safeRemaining)}% left`}
      >
        <div className="flex h-9 w-9 flex-col items-center justify-center rounded-full bg-panel-bg">
          <span className="font-mono text-[11px] font-medium text-text-primary">
            {remaining === null ? '—' : `${Math.round(safeRemaining)}%`}
          </span>
          {remaining !== null && <span className="text-[8px] text-text-muted">left</span>}
        </div>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-medium text-text-secondary">{label}</p>
        {detail && <p className="mt-0.5 truncate font-mono text-[9px] text-text-muted">{detail}</p>}
      </div>
    </div>
  )
}

function formatUsageDetail(provider: CliUsageInfo | undefined): string | undefined {
  const window = provider?.primary
  if (!window) return undefined
  if (window.resetLabel) return window.resetLabel
  if (!window.resetsAt) return undefined
  const remainingMs = window.resetsAt * 1000 - Date.now()
  if (remainingMs <= 0) return 'Resetting soon'
  const minutes = Math.ceil(remainingMs / 60000)
  if (minutes < 60) return `Resets in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `Resets in ${hours}h`
}

function AccountForm({
  account,
  onClose
}: {
  account: AiAccount | null
  onClose: () => void
}): React.JSX.Element {
  const addAccount = useAiAccountsStore((state) => state.addAccount)
  const updateAccount = useAiAccountsStore((state) => state.updateAccount)
  const [draft, setDraft] = useState<AiAccountDraft>(() =>
    account
      ? {
          kind: account.kind,
          name: account.name,
          email: account.email,
          plan: account.plan,
          note: account.note
        }
      : EMPTY_DRAFT
  )

  const update = <K extends keyof AiAccountDraft>(key: K, value: AiAccountDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!draft.name.trim()) return
    if (account) {
      updateAccount(account.id, draft)
    } else {
      addAccount(draft)
    }
    onClose()
  }

  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center overflow-auto bg-app-bg/85 p-3 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-full rounded-lg border border-border bg-elevated p-3 shadow-xl animate-slide-up"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
            {account ? <Pencil className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-medium text-text-primary">
              {account ? 'Edit AI account' : 'Add AI account'}
            </h3>
            <p className="mt-0.5 text-[10px] text-text-muted">Only profile details are stored</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted hover:bg-hover hover:text-text-primary"
            aria-label="Close account form"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium text-text-secondary">CLI</span>
            <select
              value={draft.kind}
              disabled={Boolean(account)}
              onChange={(event) => update('kind', event.target.value as CliUsageKind)}
              className="h-8 w-full rounded-md border border-border bg-panel-bg px-2 text-xs text-text-primary outline-none transition-colors focus:border-primary/60 disabled:opacity-60"
            >
              {AI_ACCOUNT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {AI_ACCOUNT_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium text-text-secondary">Account name</span>
            <input
              autoFocus
              value={draft.name}
              onChange={(event) => update('name', event.target.value)}
              placeholder="Personal account"
              className="h-8 w-full rounded-md border border-border bg-panel-bg px-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-primary/60"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium text-text-secondary">Email or handle</span>
            <input
              value={draft.email}
              onChange={(event) => update('email', event.target.value)}
              placeholder="name@example.com"
              className="h-8 w-full rounded-md border border-border bg-panel-bg px-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-primary/60"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium text-text-secondary">Plan</span>
              <input
                value={draft.plan}
                onChange={(event) => update('plan', event.target.value)}
                placeholder="Pro, Plus…"
                className="h-8 w-full rounded-md border border-border bg-panel-bg px-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-primary/60"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium text-text-secondary">Note</span>
              <input
                value={draft.note}
                onChange={(event) => update('note', event.target.value)}
                placeholder="Work account"
                className="h-8 w-full rounded-md border border-border bg-panel-bg px-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-primary/60"
              />
            </label>
          </div>
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-2.5 py-1.5 text-[10px] text-text-secondary hover:bg-hover hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-2.5 py-1.5 text-[10px] font-medium text-white transition-colors hover:bg-primary-hover"
          >
            {account ? 'Save changes' : 'Add account'}
          </button>
        </div>
      </form>
    </div>
  )
}

function AccountCard({
  account,
  provider,
  isActive,
  onOpen,
  onEdit,
  onRemove
}: {
  account: AiAccount
  provider: CliUsageInfo | undefined
  isActive: boolean
  onOpen: () => void
  onEdit: () => void
  onRemove: () => void
}): React.JSX.Element {
  const logo = getCliLogo(account.kind)
  const isConnected = account.profileReady
  const primaryRemaining = provider?.primary ? 100 - provider.primary.usedPercent : null
  const secondaryRemaining = provider?.secondary ? 100 - provider.secondary.usedPercent : null
  const matchesCurrentSignIn =
    !provider?.accountEmail ||
    !account.email ||
    provider.accountEmail.trim().toLowerCase() === account.email.trim().toLowerCase()
  const liveUsage = isActive && matchesCurrentSignIn && provider?.status === 'available'
  const primaryLabel = provider?.primary?.label ?? 'Primary limit'
  const secondaryLabel = provider?.secondary?.label ?? 'Secondary limit'
  const hasLiveWindows = Boolean(provider?.primary || provider?.secondary)

  return (
    <article
      className={cn(
        'rounded-lg border bg-panel-bg p-2.5 transition-colors',
        isActive ? 'border-primary/45 shadow-[0_0_16px_rgb(124_108_242_/_0.08)]' : 'border-border'
      )}
    >
      <div className="flex items-start gap-2">
        {logo ? <img src={logo} alt="" className={CLI_LOGO_CLASS} /> : <div className={CLI_LOGO_CLASS} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-medium text-text-primary">{account.name}</p>
            {isActive && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-success/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wide text-success">
                <Check className="h-2.5 w-2.5" /> Active
              </span>
            )}
            {isConnected && !isActive && (
              <span className="shrink-0 rounded-full bg-success/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wide text-success">
                Connected
              </span>
            )}
          </div>
          <p className="truncate text-[10px] text-text-muted">{AI_ACCOUNT_LABELS[account.kind]}</p>
          {account.email && <p className="truncate font-mono text-[9px] text-text-secondary">{account.email}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-medium text-primary hover:bg-primary/10"
            title={account.profileReady ? 'Open this account profile' : 'Sign in to this account profile'}
          >
            <Play className="h-2.5 w-2.5" />
            {!account.profileReady ? 'Sign in' : isActive ? 'Open CLI' : 'Use & open'}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1 text-text-muted hover:bg-hover hover:text-text-primary"
            aria-label={`Edit ${account.name}`}
            title="Edit account"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1 text-text-muted hover:bg-error/10 hover:text-error"
            aria-label={`Remove ${account.name}`}
            title="Remove account"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {account.plan || account.note ? (
        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[9px] text-text-muted">
          {account.plan && <span className="rounded bg-elevated px-1.5 py-0.5">{account.plan}</span>}
          {account.note && <span className="truncate">{account.note}</span>}
        </div>
      ) : null}

      {liveUsage && hasLiveWindows ? (
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {provider?.primary && (
            <CircularUsage
              label={primaryLabel}
              remaining={primaryRemaining}
              detail={formatUsageDetail(provider)}
            />
          )}
          {provider?.secondary && (
            <CircularUsage label={secondaryLabel} remaining={secondaryRemaining} />
          )}
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-border bg-app-bg/60 px-2 py-1.5 text-[9px] text-text-muted">
          {isActive && provider?.status === 'error' ? (
            <AlertCircle className="h-3 w-3 shrink-0 text-warning" />
          ) : (
            <Clock3 className="h-3 w-3 shrink-0" />
          )}
          <span>
            {!isActive
              ? 'Select this profile to pin its usage here'
              : !account.profileReady
                ? 'Sign in is required for this account profile'
              : !matchesCurrentSignIn
                ? 'Profile is ready — open it to load this account'
              : provider?.detail ?? 'Usage is not available for this CLI yet'}
          </span>
        </div>
      )}
    </article>
  )
}

export function AiAccountsPanel(): React.JSX.Element {
  const accounts = useAiAccountsStore((state) => state.accounts)
  const activeAccountByKind = useAiAccountsStore((state) => state.activeAccountByKind)
  const setActiveAccount = useAiAccountsStore((state) => state.setActiveAccount)
  const addAccount = useAiAccountsStore((state) => state.addAccount)
  const markAccountAuthenticated = useAiAccountsStore((state) => state.markAccountAuthenticated)
  const removeAccount = useAiAccountsStore((state) => state.removeAccount)
  const syncDiscoveredAccounts = useAiAccountsStore((state) => state.syncDiscoveredAccounts)
  const addPanel = useWorkspaceStore((state) => state.addPanel)
  const [usage, setUsage] = useState<CliUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formAccount, setFormAccount] = useState<AiAccount | null | undefined>(undefined)
  const importedProfileIds = useRef(new Set<string>())

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setUsage(await window.api.usage.read())
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not load AI usage')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), 5 * 60 * 1000)
    return () => window.clearInterval(interval)
  }, [refresh])

  useEffect(() => {
    const handleRefreshRequest = (): void => {
      window.setTimeout(() => void refresh(), 800)
    }
    window.addEventListener(AI_ACCOUNTS_REFRESH_EVENT, handleRefreshRequest)
    return () => window.removeEventListener(AI_ACCOUNTS_REFRESH_EVENT, handleRefreshRequest)
  }, [refresh])

  useEffect(() => {
    if (!usage) return
    syncDiscoveredAccounts(
      usage.providers.flatMap((provider) =>
        provider.accountEmail
          ? [
              {
                kind: provider.kind,
                name: provider.accountName || `${provider.label} account`,
                email: provider.accountEmail,
                plan: provider.planType ?? ''
              }
            ]
          : []
      )
    )
  }, [syncDiscoveredAccounts, usage])

  useEffect(() => {
    const handleAuthenticated = (event: Event): void => {
      const detail = (
        event as CustomEvent<{
          accountId: string
          identity?: { email?: string; name?: string }
        }>
      ).detail
      if (!detail?.accountId) return
      markAccountAuthenticated(detail.accountId, detail.identity)
    }
    window.addEventListener(AI_ACCOUNT_AUTHENTICATED_EVENT, handleAuthenticated)
    return () => window.removeEventListener(AI_ACCOUNT_AUTHENTICATED_EVENT, handleAuthenticated)
  }, [markAccountAuthenticated])

  useEffect(() => {
    if (!usage) return
    for (const provider of usage.providers) {
      if (!provider.accountEmail) continue
      const providerEmail = provider.accountEmail.trim().toLowerCase()
      const account = accounts.find(
        (candidate) =>
          candidate.kind === provider.kind &&
          candidate.email.trim().toLowerCase() === providerEmail
      )
      if (!account || account.profileReady || importedProfileIds.current.has(account.id)) continue
      importedProfileIds.current.add(account.id)
      void window.api.authProfiles
        .importCurrent({
          kind: account.kind,
          accountId: account.id,
          email: provider.accountEmail
        })
        .then((result) => {
          if (result.ready) markAccountAuthenticated(account.id, result.identity)
          else importedProfileIds.current.delete(account.id)
        })
    }
  }, [accounts, markAccountAuthenticated, usage])

  const providerByKind = useMemo(() => {
    const map = new Map<CliUsageKind, CliUsageInfo>()
    for (const provider of usage?.providers ?? []) map.set(provider.kind, provider)
    return map
  }, [usage])

  const accountsByKind = useMemo(
    () =>
      AI_ACCOUNT_KINDS.map((kind) => ({
        kind,
        accounts: accounts.filter((account) => account.kind === kind)
      })),
    [accounts]
  )

  const openAddForm = (): void => setFormAccount(null)
  const closeForm = (): void => setFormAccount(undefined)

  const importCurrentProvider = async (kind: CliUsageKind): Promise<void> => {
    const email = providerByKind.get(kind)?.accountEmail
    if (!email) return
    const current = accounts.find(
      (account) =>
        account.kind === kind && account.email.trim().toLowerCase() === email.trim().toLowerCase()
    )
    if (!current) return
    const result = await window.api.authProfiles.importCurrent({
      kind,
      accountId: current.id,
      email
    })
    if (result.ready) markAccountAuthenticated(current.id, result.identity)
  }

  const openLoginCli = async (kind: CliUsageKind, account?: AiAccount): Promise<void> => {
    await importCurrentProvider(kind)
    const accountId =
      account?.id ??
      addAccount({
        kind,
        name: `New ${AI_ACCOUNT_LABELS[kind]} account`,
        email: '',
        plan: '',
        note: ''
      })
    setActiveAccount(kind, accountId)
    addPanel(
      kind,
      'center',
      undefined,
      'login',
      accountId,
      `${AI_ACCOUNT_LABELS[kind]} · Sign in`
    )
  }

  const handleRemove = (account: AiAccount): void => {
    if (window.confirm(`Remove ${account.name}?`)) {
      void window.api.authProfiles.remove({ kind: account.kind, accountId: account.id })
      removeAccount(account.id)
    }
  }

  const openAccountCli = async (account: AiAccount): Promise<void> => {
    if (!account.profileReady) {
      await openLoginCli(account.kind, account)
      return
    }
    const activated = await window.api.authProfiles.activate({
      kind: account.kind,
      accountId: account.id,
      ...(account.email ? { email: account.email } : {})
    })
    if (!activated.ready) {
      await openLoginCli(account.kind, account)
      return
    }
    setActiveAccount(account.kind, account.id)
    addPanel(
      account.kind,
      'center',
      undefined,
      'normal',
      account.id,
      `${AI_ACCOUNT_LABELS[account.kind]} · ${account.name}`
    )
  }

  const connectCli = (kind: CliUsageKind): void => {
    void openLoginCli(kind)
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-app-bg">
      <div className="shrink-0 border-b border-border bg-elevated px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
            <UsersRound className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-medium text-text-primary">AI Accounts</h2>
            <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
              Switch between your CLI account profiles
            </p>
          </div>
          <button
            type="button"
            onClick={openAddForm}
            className="rounded-md border border-primary/35 bg-primary/10 p-1.5 text-primary transition-colors hover:bg-primary/20"
            title="Add AI account"
            aria-label="Add AI account"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[9px] text-text-muted">
          <span>{accounts.length} account{accounts.length === 1 ? '' : 's'}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-hover hover:text-text-primary disabled:opacity-50"
            title="Refresh usage"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
            {usage
              ? `Checked ${new Date(usage.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'Refresh usage'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        {error && (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-error/30 bg-error/10 p-2 text-[10px] text-error">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3">
          {accountsByKind.map(({ kind, accounts: providerAccounts }) => {
            const logo = getCliLogo(kind)
            return (
              <section key={kind}>
                <div className="mb-1.5 flex items-center gap-2 px-0.5">
                  {logo ? <img src={logo} alt="" className={CLI_LOGO_CLASS} /> : <div className={CLI_LOGO_CLASS} />}
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                      {AI_ACCOUNT_LABELS[kind]}
                    </h3>
                    <p className="text-[9px] text-text-muted">
                      {providerAccounts.length > 0
                        ? `${providerAccounts.length} saved account${providerAccounts.length === 1 ? '' : 's'}`
                        : loading
                          ? 'Checking local session…'
                          : 'No connected account detected'}
                    </p>
                  </div>
                  {providerAccounts.length > 0 && (
                    <span className="rounded-full border border-border bg-elevated px-1.5 py-0.5 font-mono text-[8px] text-text-muted">
                      {providerAccounts.length}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => connectCli(kind)}
                    disabled={providerByKind.get(kind)?.status === 'not-installed'}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-1.5 py-1 text-[9px] font-medium text-primary transition-colors hover:border-primary/45 hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                    title={
                      providerByKind.get(kind)?.status === 'not-installed'
                        ? `${AI_ACCOUNT_LABELS[kind]} is not installed`
                        : `Add account to ${AI_ACCOUNT_LABELS[kind]}`
                    }
                  >
                    <UserPlus className="h-2.5 w-2.5" />
                    Add account
                  </button>
                </div>

                {providerAccounts.length > 0 ? (
                  <div className="space-y-1.5">
                    {providerAccounts.map((account) => (
                      <AccountCard
                        key={account.id}
                        account={account}
                        provider={providerByKind.get(account.kind)}
                        isActive={activeAccountByKind[account.kind] === account.id}
                        onOpen={() => void openAccountCli(account)}
                        onEdit={() => setFormAccount(account)}
                        onRemove={() => handleRemove(account)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 rounded-md border border-dashed border-border bg-panel-bg/40 px-2 py-2 text-[9px] text-text-muted">
                    <UsersRound className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 flex-1">
                      {providerByKind.get(kind)?.status === 'not-installed'
                        ? 'CLI is not installed'
                        : 'No connected account detected'}
                    </span>
                  </div>
                )}
              </section>
            )
          })}
          <div className="flex items-start gap-1.5 px-1 pt-1 text-[9px] leading-relaxed text-text-muted">
            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
            <span>Each account uses an isolated local CLI profile. Passwords are never collected; saved sessions stay protected on this computer.</span>
          </div>
        </div>
      </div>

      {formAccount !== undefined && <AccountForm account={formAccount} onClose={closeForm} />}
    </div>
  )
}
