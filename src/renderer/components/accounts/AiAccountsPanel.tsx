import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  Pencil,
  Play,
  Plus,
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
import type { CliUsageInfo, CliUsageKind } from '@shared/contracts/usage'
import { CLI_LOGO_CLASS, getCliLogo } from '@renderer/lib/cli-logos'
import {
  type AiAccountDraft,
  useAiAccountsStore
} from '@renderer/stores/ai-accounts-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useUsageStore } from '@renderer/stores/usage-store'
import { cn } from '@renderer/lib/utils'
import {
  importSystemAccountForKind,
  syncDiscoveredSystemAccounts
} from '@renderer/lib/system-auth-sync'

let installedCliCache: Partial<Record<CliUsageKind, boolean>> = {}

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
            <p className="mt-0.5 text-[10px] text-text-muted">
              Sign-in sessions stay in protected, app-managed profiles
            </p>
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
  isRemoving,
  onOpen,
  onEdit,
  onRemove
}: {
  account: AiAccount
  provider: CliUsageInfo | undefined
  isActive: boolean
  isRemoving: boolean
  onOpen: () => void
  onEdit: () => void
  onRemove: () => void
}): React.JSX.Element {
  const logo = getCliLogo(account.kind)
  const isConnected = account.profileReady
  const primaryRemaining = provider?.primary ? 100 - provider.primary.usedPercent : null
  const secondaryRemaining = provider?.secondary ? 100 - provider.secondary.usedPercent : null
  const liveUsage = provider?.status === 'available'
  const primaryLabel = provider?.primary?.label ?? 'Primary limit'
  const secondaryLabel = provider?.secondary?.label ?? 'Secondary limit'
  const breakdownGauges = (provider?.breakdown ?? [])
    .filter((item) => typeof item.usedPercent === 'number')
    .slice(0, 2)
  const hasLiveWindows = Boolean(
    provider?.primary || provider?.secondary || (liveUsage && breakdownGauges.length > 0)
  )
  const displayEmail = account.email || provider?.accountEmail
  const displayPlan = account.plan || provider?.planType || undefined

  return (
    <article
      className={cn(
        'rounded-lg border bg-panel-bg p-2.5 transition-colors',
        isActive ? 'border-primary/45 shadow-[0_0_16px_rgb(124_108_242_/_0.08)]' : 'border-border',
        isRemoving && 'pointer-events-none opacity-60'
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
          {displayEmail && (
            <p className="truncate font-mono text-[9px] text-text-secondary">{displayEmail}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onOpen}
            disabled={isRemoving}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-medium text-primary hover:bg-primary/10"
            title={account.profileReady ? 'Open this account profile' : 'Sign in to this account profile'}
          >
            <Play className="h-2.5 w-2.5" />
            {!account.profileReady ? 'Sign in' : isActive ? 'Open CLI' : 'Use & open'}
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={isRemoving}
            className="rounded-md p-1 text-text-muted hover:bg-hover hover:text-text-primary"
            aria-label={`Edit ${account.name}`}
            title="Edit account"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={isRemoving}
            className="rounded-md p-1 text-text-muted hover:bg-error/10 hover:text-error"
            aria-label={`Remove ${account.name}`}
            title="Remove account"
          >
            <Trash2 className={cn('h-3 w-3', isRemoving && 'animate-pulse')} />
          </button>
        </div>
      </div>

      {displayPlan || account.note ? (
        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[9px] text-text-muted">
          {displayPlan && <span className="rounded bg-elevated px-1.5 py-0.5">{displayPlan}</span>}
          {account.note && <span className="truncate">{account.note}</span>}
        </div>
      ) : null}

      {liveUsage && hasLiveWindows ? (
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {provider?.primary ? (
            <CircularUsage
              label={primaryLabel}
              remaining={primaryRemaining}
              detail={formatUsageDetail(provider)}
            />
          ) : breakdownGauges[0] ? (
            <CircularUsage
              label={breakdownGauges[0].label}
              remaining={100 - (breakdownGauges[0].usedPercent ?? 0)}
            />
          ) : null}
          {provider?.secondary ? (
            <CircularUsage label={secondaryLabel} remaining={secondaryRemaining} />
          ) : !provider?.primary && breakdownGauges[1] ? (
            <CircularUsage
              label={breakdownGauges[1].label}
              remaining={100 - (breakdownGauges[1].usedPercent ?? 0)}
            />
          ) : null}
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-border bg-app-bg/60 px-2 py-1.5 text-[9px] text-text-muted">
          {provider?.status === 'error' ? (
            <AlertCircle className="h-3 w-3 shrink-0 text-warning" />
          ) : (
            <Clock3 className="h-3 w-3 shrink-0" />
          )}
          <span>
            {!account.profileReady
              ? 'Sign in is required for this account profile'
              : provider?.detail ?? 'Usage has not been checked yet'}
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
  const removeAccount = useAiAccountsStore((state) => state.removeAccount)
  const syncAuthProfiles = useAiAccountsStore((state) => state.syncAuthProfiles)
  const usageProviders = useUsageStore((state) => state.providers)
  const checkedAtByAccountId = useUsageStore((state) => state.checkedAtByAccountId)
  const removeUsageAccount = useUsageStore((state) => state.removeAccount)
  const addPanel = useWorkspaceStore((state) => state.addPanel)
  const removePanelsForAccount = useWorkspaceStore((state) => state.removePanelsForAccount)
  const closeOtherAccountCliPanels = useWorkspaceStore((state) => state.closeOtherAccountCliPanels)
  const [error, setError] = useState<string | null>(null)
  const [formAccount, setFormAccount] = useState<AiAccount | null | undefined>(undefined)
  const [removingAccountIds, setRemovingAccountIds] = useState<Set<string>>(() => new Set())
  const [installedByKind, setInstalledByKind] = useState<
    Partial<Record<CliUsageKind, boolean>>
  >(() => installedCliCache)

  const refreshInstalledClis = useCallback(async (): Promise<void> => {
    const entries = await Promise.all(
      AI_ACCOUNT_KINDS.map(async (kind) => {
        try {
          const result = await window.api.cli.detect(kind)
          return [kind, result.installed] as const
        } catch {
          return [kind, false] as const
        }
      })
    )
    installedCliCache = Object.fromEntries(entries)
    setInstalledByKind(installedCliCache)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const profiles = await window.api.authProfiles.list()
        if (cancelled) return
        syncAuthProfiles(profiles)
        await syncDiscoveredSystemAccounts()
        if (!cancelled) await refreshInstalledClis()
      } catch (listError) {
        if (!cancelled) {
          setError(listError instanceof Error ? listError.message : 'Could not load saved accounts')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshInstalledClis, syncAuthProfiles])

  const providerByAccount = useMemo(() => {
    const map = new Map<string, CliUsageInfo>()
    for (const provider of usageProviders) {
      if (provider.accountId) map.set(provider.accountId, provider)
    }
    return map
  }, [usageProviders])

  const lastCheckedAt = useMemo(() => {
    const times = accounts
      .map((account) => checkedAtByAccountId[account.id])
      .filter((value): value is number => typeof value === 'number')
    if (times.length === 0) return null
    return Math.max(...times)
  }, [accounts, checkedAtByAccountId])

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

  const openLoginCli = async (kind: CliUsageKind, account?: AiAccount): Promise<void> => {
    if (installedByKind[kind] === false) {
      setError(`${AI_ACCOUNT_LABELS[kind]} is not installed on this computer`)
      return
    }
    const accountId =
      account?.id ??
      addAccount({
        kind,
        name: `New ${AI_ACCOUNT_LABELS[kind]} account`,
        email: '',
        plan: '',
        note: ''
      })
    if (kind === 'cursor' || kind === 'antigravity') {
      closeOtherAccountCliPanels(kind, accountId)
    } else {
      removePanelsForAccount(kind, accountId)
    }
    addPanel(
      kind,
      'center',
      undefined,
      'login',
      accountId,
      `${AI_ACCOUNT_LABELS[kind]} · Sign in`
    )
  }

  const openGlobalCli = async (kind: CliUsageKind): Promise<void> => {
    if (installedByKind[kind] === false) {
      setError(`${AI_ACCOUNT_LABELS[kind]} is not installed on this computer`)
      return
    }
    setError(null)

    try {
      const importedAccount = await importSystemAccountForKind(kind)
      if (importedAccount) {
        await openAccountCli(importedAccount)
        return
      }
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : `Could not import ${AI_ACCOUNT_LABELS[kind]} account`
      )
      return
    }

    if (kind === 'antigravity' || kind === 'cursor') {
      await openLoginCli(kind)
      return
    }

    addPanel(kind, 'center', undefined, 'normal', undefined, AI_ACCOUNT_LABELS[kind])
  }

  const handleRemove = async (account: AiAccount): Promise<void> => {
    if (
      !window.confirm(
        account.kind === 'antigravity' || account.kind === 'cursor'
          ? `Sign out and remove ${account.name}? This signs ${AI_ACCOUNT_LABELS[account.kind]} out on this computer and closes open sessions.`
          : `Sign out and remove ${account.name}? Open sessions for this account will be closed.`
      )
    ) {
      return
    }

    setError(null)
    setRemovingAccountIds((current) => new Set(current).add(account.id))
    removePanelsForAccount(account.kind, account.id)
    try {
      const result = await window.api.authProfiles.remove({
        kind: account.kind,
        accountId: account.id
      })
      if (!result.ok) throw new Error(result.error ?? 'Could not sign out this CLI account')

      removeAccount(account.id)
      removeUsageAccount(account.id)
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : 'Could not remove CLI account'
      )
    } finally {
      setRemovingAccountIds((current) => {
        const next = new Set(current)
        next.delete(account.id)
        return next
      })
    }
  }

  const openAccountCli = async (account: AiAccount): Promise<void> => {
    if (!account.profileReady) {
      await openLoginCli(account.kind, account)
      return
    }
    setError(null)
    try {
      const activated = await window.api.authProfiles.activate({
        kind: account.kind,
        accountId: account.id,
        ...(account.email ? { email: account.email } : {})
      })
      if (!activated.ok) {
        setError(activated.error ?? `Could not activate ${account.name}`)
        return
      }
      if (!activated.ready) {
        await openLoginCli(account.kind, account)
        return
      }
      if (account.kind === 'antigravity') {
        closeOtherAccountCliPanels(account.kind, account.id)
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
    } catch (activateError) {
      setError(
        activateError instanceof Error ? activateError.message : `Could not activate ${account.name}`
      )
    }
  }

  const connectCli = (kind: CliUsageKind): void => {
    const kindAccounts = accounts.filter((account) => account.kind === kind)
    if (kindAccounts.length === 0) {
      void openGlobalCli(kind)
      return
    }
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
              Sign in, switch, inspect usage and sign out from one place
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
          <span>
            {lastCheckedAt
              ? `Updated ${new Date(lastCheckedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'Usage updates in the background'}
          </span>
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
                        : installedByKind[kind] === false
                          ? 'CLI is not installed'
                          : installedByKind[kind] === undefined
                            ? 'Checking installation…'
                            : 'No managed account'}
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
                    disabled={installedByKind[kind] === false}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-1.5 py-1 text-[9px] font-medium text-primary transition-colors hover:border-primary/45 hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                    title={
                      installedByKind[kind] === false
                        ? `${AI_ACCOUNT_LABELS[kind]} is not installed`
                        : providerAccounts.length === 0
                          ? `Open ${AI_ACCOUNT_LABELS[kind]} with your system session`
                          : `Add account to ${AI_ACCOUNT_LABELS[kind]}`
                    }
                  >
                    {providerAccounts.length === 0 ? (
                      <>
                        <Play className="h-2.5 w-2.5" />
                        Open CLI
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-2.5 w-2.5" />
                        Add account
                      </>
                    )}
                  </button>
                </div>

                {providerAccounts.length > 0 ? (
                  <div className="space-y-1.5">
                    {providerAccounts.map((account) => (
                      <AccountCard
                        key={account.id}
                        account={account}
                        provider={providerByAccount.get(account.id)}
                        isActive={activeAccountByKind[account.kind] === account.id}
                        isRemoving={removingAccountIds.has(account.id)}
                        onOpen={() => void openAccountCli(account)}
                        onEdit={() => setFormAccount(account)}
                        onRemove={() => void handleRemove(account)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-panel-bg/40 p-2">
                    <div className="flex items-center gap-1.5 text-[9px] text-text-muted">
                      <UsersRound className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1">
                        {installedByKind[kind] === false
                          ? 'CLI is not installed'
                          : kind === 'antigravity' || kind === 'cursor'
                            ? 'No managed account yet. Open CLI starts a fresh sign-in and will not reuse the previous system session.'
                            : 'No managed account yet. Open the CLI with your system session or add an account for isolated profiles.'}
                      </span>
                    </div>
                    {installedByKind[kind] !== false && (
                      <button
                        type="button"
                        onClick={() => void openGlobalCli(kind)}
                        className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-2 py-1.5 text-[10px] font-medium text-primary transition-colors hover:border-primary/45 hover:bg-primary/20"
                      >
                        <Play className="h-3 w-3" />
                        Open {AI_ACCOUNT_LABELS[kind]}
                      </button>
                    )}
                  </div>
                )}
              </section>
            )
          })}
          <div className="flex items-start gap-1.5 px-1 pt-1 text-[9px] leading-relaxed text-text-muted">
            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
            <span>
              You can save more than one Cursor CLI account and open each CLI to inspect it.
              Antigravity still uses one live session at a time.
            </span>
          </div>
        </div>
      </div>

      {formAccount !== undefined && <AccountForm account={formAccount} onClose={closeForm} />}
    </div>
  )
}
