import { buttonStyles } from '@renderer/components/ui/Button'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X
} from 'lucide-react'
import {
  AI_ACCOUNT_KINDS,
  AI_ACCOUNT_LABELS,
  type AiAccount
} from '@shared/contracts/accounts'
import type { CliUsageInfo, CliUsageKind, CliUsageWindow } from '@shared/contracts/usage'
import type { SubscriptionRecord } from '@shared/contracts/persistence'
import { getCliLogo } from '@renderer/lib/cli-logos'
import {
  type AiAccountDraft,
  useAiAccountsStore
} from '@renderer/stores/ai-accounts-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useUsageStore } from '@renderer/stores/usage-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useSubscriptionStore } from '@renderer/stores/subscription-store'
import { cn } from '@renderer/lib/utils'
import { importSystemAccountForKind } from '@renderer/lib/system-auth-sync'
import { checkAccountUsage, checkAllAccountUsage, invalidateAccountUsage } from '@renderer/lib/usage-sync'

let installedCliCache: Partial<Record<CliUsageKind, boolean>> = {}

function CliKindPicker({
  accounts,
  installedByKind,
  addingKind,
  onPick
}: {
  accounts: AiAccount[]
  installedByKind: Partial<Record<CliUsageKind, boolean>>
  addingKind: CliUsageKind | null
  onPick: (kind: CliUsageKind) => void
}): React.JSX.Element {
  return (
    <div className="cli-kind-picker">
      {AI_ACCOUNT_KINDS.map((kind) => {
        const count = accounts.filter((account) => account.kind === kind).length
        const installed = installedByKind[kind]
        const adding = addingKind === kind
        const logo = getCliLogo(kind)
        return (
          <button
            key={kind}
            type="button"
            disabled={installed === false || addingKind !== null}
            onClick={() => onPick(kind)}
            className={cn('cli-kind-tile', count > 0 && 'is-present')}
          >
            {logo ? (
              <img src={logo} alt="" className="cli-kind-tile-logo" />
            ) : (
              <span className="cli-kind-tile-logo" />
            )}
            <span className="cli-kind-tile-name">{AI_ACCOUNT_LABELS[kind]}</span>
            <span className="cli-kind-tile-meta">
              {installed === false
                ? 'Missing'
                : adding
                  ? 'Adding'
                  : count > 0
                    ? String(count)
                    : 'Add'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function usageColor(remaining: number): string {
  if (remaining <= 10) return '#f05d68'
  if (remaining <= 30) return '#f2b84b'
  return '#3ccb7f'
}

function UsageMeter({
  remaining,
  label,
  name,
  display = 'remaining'
}: {
  remaining: number | null
  label?: string
  name?: string
  display?: 'remaining' | 'used'
}): React.JSX.Element {
  const left = remaining === null ? null : Math.max(0, Math.min(100, remaining))
  const shown = left === null ? null : display === 'used' ? 100 - left : left
  const color = left === null ? '#3a414c' : usageColor(left)

  return (
    <div className="account-meter" title={label}>
      {name ? <span className="account-meter-name">{name}</span> : null}
      <div className="account-meter-track">
        <div
          className="account-meter-fill"
          style={{
            width: `${shown ?? 0}%`,
            background: color
          }}
        />
      </div>
      <span className="account-meter-value" style={{ color: shown === null ? undefined : color }}>
        {shown === null ? '—' : Math.round(shown)}
      </span>
    </div>
  )
}

function formatUsageDetail(window: CliUsageWindow | undefined): string | undefined {
  if (!window) return undefined
  if (window.resetLabel) return window.resetLabel
  if (!window.resetsAt) return undefined
  const remainingMs = window.resetsAt * 1000 - Date.now()
  if (remainingMs <= 0) return 'Resetting soon'
  const minutes = Math.ceil(remainingMs / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h`
}

function meterFromWindow(
  window: CliUsageWindow,
  showUsed = false
): { remaining: number; label: string; name: string; display: 'remaining' | 'used' } {
  const used = Math.round(window.usedPercent)
  return {
    remaining: 100 - window.usedPercent,
    name: window.label || 'Limit',
    display: showUsed ? 'used' : 'remaining',
    label: [window.label, `${used}% used`, formatUsageDetail(window)].filter(Boolean).join(' · ')
  }
}

function formatSubscriptionMoney(subscription: SubscriptionRecord): string {
  try {
    return new Intl.NumberFormat([], {
      style: 'currency',
      currency: subscription.currency || 'USD',
      maximumFractionDigits: 2
    }).format(subscription.amount)
  } catch {
    return `${subscription.currency} ${subscription.amount.toFixed(2)}`
  }
}

function AccountForm({
  account,
  onClose
}: {
  account: AiAccount
  onClose: () => void
}): React.JSX.Element {
  const updateAccount = useAiAccountsStore((state) => state.updateAccount)
  const [draft, setDraft] = useState<AiAccountDraft>(() => ({
    kind: account.kind,
    name: account.name,
    email: account.email,
    plan: account.plan,
    note: account.note
  }))

  const update = <K extends keyof AiAccountDraft>(key: K, value: AiAccountDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!draft.name.trim()) return
    updateAccount(account.id, draft)
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
            <Pencil className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-medium text-text-primary">Edit account</h3>
            <p className="mt-0.5 text-[10px] text-text-muted">{AI_ACCOUNT_LABELS[account.kind]}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })}
            aria-label="Close account form"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-3 space-y-2">
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
              disabled={account.kind === 'cursor'}
              title={account.kind === 'cursor' ? 'The email is verified when you log in.' : undefined}
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
            className={buttonStyles()}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={buttonStyles({ variant: 'primary' })}
          >
            Save changes
          </button>
        </div>
      </form>
    </div>
  )
}

function AccountCard({
  account,
  provider,
  subscriptions,
  isActive,
  isRemoving,
  isChecking,
  onCheck,
  onLogout,
  onOpen,
  onEdit,
  onRemove
}: {
  account: AiAccount
  provider: CliUsageInfo | undefined
  subscriptions: SubscriptionRecord[]
  isActive: boolean
  isRemoving: boolean
  isChecking: boolean
  onCheck: () => void
  onLogout: () => void
  onOpen: () => void
  onEdit: () => void
  onRemove: () => void
}): React.JSX.Element {
  const usageBelongsToAccount =
    !account.email ||
    !provider?.accountEmail ||
    account.email.trim().toLowerCase() === provider.accountEmail.trim().toLowerCase()
  const liveUsage = account.profileReady && provider?.status === 'available' && usageBelongsToAccount &&
    (account.kind !== 'cursor' || provider.identityVerified === true)
  const meters: { remaining: number; label: string; name?: string; display?: 'remaining' | 'used' }[] = []
  const showUsed = account.kind === 'cursor'
  if (liveUsage && provider?.primary) {
    meters.push(meterFromWindow(provider.primary, showUsed))
  } else if (liveUsage) {
    for (const item of (provider?.breakdown ?? []).filter((entry) => typeof entry.usedPercent === 'number').slice(0, 2)) {
      meters.push({
        remaining: 100 - (item.usedPercent ?? 0),
        name: item.label ?? 'Limit',
        label: item.label ?? 'Limit'
      })
    }
  }
  if (liveUsage && provider?.secondary) {
    meters.push(meterFromWindow(provider.secondary, showUsed))
  }
  const displayLine = [account.email || undefined, account.plan || provider?.planType || undefined]
    .filter(Boolean)
    .join(' · ')
  const subscription = subscriptions[0]
  const actionLabel = !account.profileReady ? 'Login' : isActive ? 'Open' : 'Use'

  return (
    <article
      className={cn(
        'account-card',
        isActive && 'is-active',
        isRemoving && 'is-removing'
      )}
    >
      <div className="account-card-top">
        <div className="min-w-0 flex-1">
          <div className="account-card-title">
            <span className={cn('account-status-dot', account.profileReady ? 'is-ready' : 'is-wait', isActive && 'is-live')} />
            <p>{account.name}</p>
          </div>
          {displayLine ? <p className="account-card-meta">{displayLine}</p> : null}
        </div>
        <button
          type="button"
          onClick={onOpen}
          disabled={isRemoving}
          className="account-card-go"
          title={actionLabel}
        >
          {actionLabel}
        </button>
      </div>

      <div className="account-card-usage">
        {meters.length > 0 ? (
          meters.map((meter, index) => (
            <UsageMeter
              key={`${meter.name ?? meter.label}-${index}`}
              remaining={meter.remaining}
              label={meter.label}
              name={meter.name}
              display={meter.display}
            />
          ))
        ) : (
          <UsageMeter remaining={null} label={isChecking ? 'Checking…' : account.profileReady ? provider?.detail || 'No usage yet' : 'Login required'} />
        )}
      </div>
      {account.kind === 'cursor' && meters.length === 0 && (
        <p className="mt-1 text-[10px] text-text-muted" role="status">
          {isChecking ? 'Checking this account…' : !account.profileReady ? 'Login to connect this account.' : provider?.detail || 'Usage has not been checked yet.'}
        </p>
      )}

      <div className="account-card-foot">
        {subscription ? (
          <span className="account-card-price">{formatSubscriptionMoney(subscription)}</span>
        ) : (
          <span />
        )}
        <div className="account-card-tools">
          <button type="button" className="account-card-action" onClick={onCheck} disabled={isRemoving || isChecking || !account.profileReady} title="Check this account usage" aria-label={`Check ${account.name} usage`}>
            <RefreshCw className={cn('h-3 w-3', isChecking && 'animate-spin')} />
            Check
          </button>
          {account.kind === 'cursor' && account.profileReady && (
            <button type="button" className="account-card-action" onClick={onLogout} disabled={isRemoving} aria-label={`Logout ${account.name}`}>
              Logout
            </button>
          )}
          <button type="button" onClick={onEdit} disabled={isRemoving} aria-label={`Edit ${account.name}`}>
            <Pencil className="h-3 w-3" />
          </button>
          <button type="button" onClick={onRemove} disabled={isRemoving} aria-label={`Remove ${account.name}`}>
            <Trash2 className={cn('h-3 w-3', isRemoving && 'animate-pulse')} />
          </button>
        </div>
      </div>
    </article>
  )
}

export function AiAccountsPanel(): React.JSX.Element {
  const accounts = useAiAccountsStore((state) => state.accounts)
  const activeAccountByKind = useAiAccountsStore((state) => state.activeAccountByKind)
  const setActiveAccount = useAiAccountsStore((state) => state.setActiveAccount)
  const addAccount = useAiAccountsStore((state) => state.addAccount)
  const removeAccount = useAiAccountsStore((state) => state.removeAccount)
  const markAccountLoggedOut = useAiAccountsStore((state) => state.markAccountLoggedOut)
  const syncAuthProfiles = useAiAccountsStore((state) => state.syncAuthProfiles)
  const usageProviders = useUsageStore((state) => state.providers)
  const removeUsageAccount = useUsageStore((state) => state.removeAccount)
  const subscriptions = useSubscriptionStore((state) => state.subscriptions)
  const addPanel = useWorkspaceStore((state) => state.addPanel)
  const removePanelsForAccount = useWorkspaceStore((state) => state.removePanelsForAccount)
  const closeOtherAccountCliPanels = useWorkspaceStore((state) => state.closeOtherAccountCliPanels)
  const [error, setError] = useState<string | null>(null)
  const [formAccount, setFormAccount] = useState<AiAccount | undefined>(undefined)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [addingKind, setAddingKind] = useState<CliUsageKind | null>(null)
  const [removingAccountIds, setRemovingAccountIds] = useState<Set<string>>(() => new Set())
  const [refreshingUsage, setRefreshingUsage] = useState(false)
  const [checkingAccountIds, setCheckingAccountIds] = useState<Set<string>>(() => new Set())
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

  const subscriptionsByAccount = useMemo(() => {
    const map = new Map<string, SubscriptionRecord[]>()
    for (const subscription of subscriptions) {
      if (!subscription.accountId) continue
      const current = map.get(subscription.accountId) ?? []
      current.push(subscription)
      map.set(subscription.accountId, current)
    }
    return map
  }, [subscriptions])

  const refreshUsage = async (): Promise<void> => {
    if (refreshingUsage) return
    setRefreshingUsage(true)
    setError(null)
    try {
      await checkAllAccountUsage()
    } catch (refreshError) {
      setError(
        refreshError instanceof Error ? refreshError.message : 'Could not refresh account usage'
      )
    } finally {
      setRefreshingUsage(false)
    }
  }

  const accountsByKind = useMemo(
    () =>
      AI_ACCOUNT_KINDS.map((kind) => ({
        kind,
        accounts: accounts.filter((account) => account.kind === kind)
      })).filter((group) => group.accounts.length > 0),
    [accounts]
  )

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
    if (kind === 'cursor') {
      invalidateAccountUsage(accountId)
      markAccountLoggedOut(accountId)
      removeUsageAccount(accountId)
    }
    if (kind === 'antigravity') {
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

  const handleRemove = async (account: AiAccount): Promise<void> => {
    if (
      !window.confirm(
        account.kind === 'antigravity'
          ? `Sign out and remove ${account.name}? This signs ${AI_ACCOUNT_LABELS[account.kind]} out on this computer and closes open sessions.`
          : `Sign out and remove ${account.name}? Open sessions for this account will be closed.`
      )
    ) {
      return
    }

    setError(null)
    invalidateAccountUsage(account.id)
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
      if (account.kind === 'cursor') {
        const existing = useWorkspaceStore.getState().getActiveWorkspace()?.panels.find(
          (panel) => panel.type === 'cursor' && panel.accountId === account.id && panel.launchMode !== 'login' &&
            ['starting', 'running', 'waiting', 'busy'].includes(useTerminalStore.getState().getStatus(panel.id) ?? '')
        )
        if (existing) {
          window.dispatchEvent(new CustomEvent('bikorch:focus-panel', { detail: existing.id }))
          return
        }
      }
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

  const addCliKind = async (kind: CliUsageKind): Promise<void> => {
    if (addingKind) return
    setPickerOpen(false)
    setError(null)
    setAddingKind(kind)

    try {
      let installed = installedByKind[kind]
      if (installed === undefined) {
        try {
          const result = await window.api.cli.detect(kind)
          installed = result.installed
          setInstalledByKind((current) => ({ ...current, [kind]: installed }))
        } catch {
          installed = true
        }
      }
      if (installed === false) {
        setError(`${AI_ACCOUNT_LABELS[kind]} is not installed on this computer`)
        return
      }

      const alreadyAdded = accounts.some((account) => account.kind === kind)
      if (!alreadyAdded) {
        const importedAccount = await importSystemAccountForKind(kind)
        if (importedAccount) return
      }

      await openLoginCli(kind)
    } catch (addError) {
      setError(
        addError instanceof Error
          ? addError.message
          : `Could not add ${AI_ACCOUNT_LABELS[kind]}`
      )
    } finally {
      setAddingKind(null)
    }
  }

  const logoutAccount = async (account: AiAccount): Promise<void> => {
    invalidateAccountUsage(account.id)
    setRemovingAccountIds((current) => new Set(current).add(account.id))
    setError(null)
    try {
      const result = await window.api.authProfiles.logout({ kind: account.kind, accountId: account.id })
      if (!result.ok) throw new Error(result.error || 'Could not log out this account')
      removePanelsForAccount(account.kind, account.id)
      markAccountLoggedOut(account.id)
      removeUsageAccount(account.id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not log out this account')
    } finally {
      setRemovingAccountIds((current) => { const next = new Set(current); next.delete(account.id); return next })
    }
  }

  const checkUsage = async (account: AiAccount): Promise<void> => {
    setCheckingAccountIds((current) => new Set(current).add(account.id))
    try { await checkAccountUsage(account) }
    finally { setCheckingAccountIds((current) => { const next = new Set(current); next.delete(account.id); return next }) }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-app-bg">
      <div className="account-panel-header shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">Accounts</h2>
          <div className="flex shrink-0 items-center gap-0.5">
            {accounts.length > 0 && (
              <button
                type="button"
                onClick={() => void refreshUsage()}
                disabled={refreshingUsage}
                className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })}
                title="Refresh"
                aria-label="Refresh usage"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', refreshingUsage && 'animate-spin')} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className={buttonStyles({ variant: 'primary', size: 'icon-sm' })}
              title="Add CLI"
              aria-label="Add CLI"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        {error && (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-error/30 bg-error/10 p-2 text-[10px] text-error">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {accountsByKind.length === 0 ? (
          <div className="account-panel-empty">
            <CliKindPicker
              accounts={accounts}
              installedByKind={installedByKind}
              addingKind={addingKind}
              onPick={(kind) => void addCliKind(kind)}
            />
          </div>
        ) : (
          <div className="account-provider-list">
            {accountsByKind.map(({ kind, accounts: providerAccounts }) => {
              const logo = getCliLogo(kind)
              return (
                <section key={kind} className="account-provider">
                  <div className="account-provider-heading">
                    {logo ? (
                      <img src={logo} alt="" className="account-provider-logo" />
                    ) : (
                      <span className="account-provider-logo" />
                    )}
                    <h3>{AI_ACCOUNT_LABELS[kind]}</h3>
                    <button
                      type="button"
                      onClick={() => void addCliKind(kind)}
                      disabled={installedByKind[kind] === false || addingKind !== null}
                      className="account-provider-add"
                      title="Add account"
                      aria-label={`Add ${AI_ACCOUNT_LABELS[kind]} account`}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="account-provider-cards">
                    {providerAccounts.map((account) => (
                      <AccountCard
                        key={account.id}
                        account={account}
                        provider={providerByAccount.get(account.id)}
                        subscriptions={subscriptionsByAccount.get(account.id) ?? []}
                        isActive={activeAccountByKind[account.kind] === account.id}
                        isRemoving={removingAccountIds.has(account.id)}
                        isChecking={checkingAccountIds.has(account.id)}
                        onCheck={() => void checkUsage(account)}
                        onLogout={() => void logoutAccount(account)}
                        onOpen={() => void openAccountCli(account)}
                        onEdit={() => setFormAccount(account)}
                        onRemove={() => void handleRemove(account)}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>

      {pickerOpen && (
        <div className="absolute inset-0 z-20 flex items-start justify-center overflow-auto bg-app-bg/88 p-3 backdrop-blur-sm">
          <div className="cli-kind-picker-sheet">
            <div className="mb-3 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-medium text-text-primary">Add CLI</h3>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })}
                aria-label="Close CLI picker"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <CliKindPicker
              accounts={accounts}
              installedByKind={installedByKind}
              addingKind={addingKind}
              onPick={(kind) => void addCliKind(kind)}
            />
          </div>
        </div>
      )}

      {formAccount && <AccountForm account={formAccount} onClose={closeForm} />}
    </div>
  )
}
