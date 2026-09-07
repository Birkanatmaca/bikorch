import { useMemo } from 'react'
import { UsersRound } from 'lucide-react'
import { AI_ACCOUNT_LABELS, type AiAccount } from '@shared/contracts/accounts'
import type { UsageSnapshotRecord } from '@shared/contracts/persistence'
import type { CliUsageInfo } from '@shared/contracts/usage'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useSubscriptionStore } from '@renderer/stores/subscription-store'
import { useUsageStore } from '@renderer/stores/usage-store'
import { cn } from '@renderer/lib/utils'
import { formatDateTime, formatMoney, formatPercent, UNAVAILABLE } from './profile-format'
import { SectionCard } from './ProfilePrimitives'

function latestRecord(records: UsageSnapshotRecord[]): UsageSnapshotRecord | undefined {
  return records.reduce<UsageSnapshotRecord | undefined>(
    (latest, record) => (!latest || record.checkedAt > latest.checkedAt ? record : latest),
    undefined
  )
}

function usageTone(usedPercent: number | undefined): string {
  if (typeof usedPercent !== 'number') return 'profile-usage-unavailable'
  if (usedPercent >= 80) return 'profile-usage-danger'
  if (usedPercent >= 60) return 'profile-usage-warning'
  return 'profile-usage-good'
}

function providerStatus(provider: CliUsageInfo | undefined): string {
  if (!provider) return 'No snapshot'
  if (provider.status === 'available') return 'Live'
  if (provider.status === 'error') return 'Error'
  if (provider.status === 'not-installed') return 'Not installed'
  return UNAVAILABLE
}

function formatResets(resetsAt: number | null | undefined): string {
  if (!resetsAt) return UNAVAILABLE
  return new Date(resetsAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

function AccountHealth({
  account,
  provider,
  records,
  subscriptionLabel
}: {
  account: AiAccount
  provider: CliUsageInfo | undefined
  records: UsageSnapshotRecord[]
  subscriptionLabel: string | null
}): React.JSX.Element {
  const latest = latestRecord(records)
  const usedPercent = provider?.primary?.usedPercent ?? latest?.primaryUsedPercent
  const secondaryPercent = provider?.secondary?.usedPercent ?? latest?.secondaryUsedPercent
  const tone = usageTone(usedPercent)
  const plan = provider?.planType ?? account.plan ?? latest?.planType
  const credits = provider?.credits
  const creditsLabel = credits
    ? credits.unlimited
      ? 'Unlimited'
      : credits.balance ?? (credits.hasCredits ? 'Available' : 'None')
    : UNAVAILABLE

  return (
    <article className="profile-account-row">
      <div className="profile-account-main">
        <div className="profile-account-icon"><UsersRound className="h-3.5 w-3.5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <strong className="truncate text-[11px] text-text-primary">{account.name}</strong>
            <span className={cn('profile-status-dot', account.profileReady ? 'profile-status-ready' : 'profile-status-muted')} />
          </div>
          <p className="truncate text-[9px] text-text-muted">
            {AI_ACCOUNT_LABELS[account.kind]}{account.email ? ` · ${account.email}` : ''}
          </p>
        </div>
        <span className={cn('profile-provider-status', provider?.status === 'available' && 'profile-status-ready')}>
          {providerStatus(provider)}
        </span>
      </div>
      <div className="profile-account-metrics">
        <div className="profile-account-bar">
          <div className={cn('profile-account-bar-fill', tone)} style={{ width: `${usedPercent ?? 0}%` }} />
        </div>
        <div className="profile-account-metric-labels">
          <span>{provider?.primary?.label ?? 'Primary'} used <strong>{formatPercent(usedPercent)}</strong></span>
          <span>Resets <strong>{formatResets(provider?.primary?.resetsAt ?? latest?.primaryResetsAt)}</strong></span>
        </div>
        {(secondaryPercent !== undefined || provider?.secondary) && (
          <div className="profile-account-metric-labels">
            <span>{provider?.secondary?.label ?? 'Secondary'} used <strong>{formatPercent(secondaryPercent)}</strong></span>
            <span>Resets <strong>{formatResets(provider?.secondary?.resetsAt ?? latest?.secondaryResetsAt)}</strong></span>
          </div>
        )}
        <div className="profile-account-metric-labels">
          <span>Plan <strong>{plan || UNAVAILABLE}</strong></span>
          <span>Credits <strong>{creditsLabel}</strong></span>
        </div>
        <div className="profile-account-metric-labels">
          <span>Subscription <strong>{subscriptionLabel ?? 'Not set'}</strong></span>
          <span>Last check <strong>{formatDateTime(latest?.checkedAt ?? null)}</strong></span>
        </div>
      </div>
    </article>
  )
}

export function AiAccountsSection(): React.JSX.Element {
  const accounts = useAiAccountsStore((state) => state.accounts)
  const providers = useUsageStore((state) => state.providers)
  const history = useUsageStore((state) => state.history)
  const subscriptions = useSubscriptionStore((state) => state.subscriptions)

  const providerByAccount = useMemo(
    () => new Map(providers.filter((provider) => provider.accountId).map((provider) => [provider.accountId, provider])),
    [providers]
  )
  const historyByAccount = useMemo(() => {
    const map = new Map<string, UsageSnapshotRecord[]>()
    for (const record of history) {
      const records = map.get(record.accountId) ?? []
      records.push(record)
      map.set(record.accountId, records)
    }
    return map
  }, [history])
  const subscriptionByAccount = useMemo(() => {
    const map = new Map<string, string>()
    for (const subscription of subscriptions) {
      if (!subscription.accountId) continue
      map.set(
        subscription.accountId,
        `${formatMoney(subscription.amount, subscription.currency)} / ${subscription.billingPeriod === 'yearly' ? 'yr' : subscription.billingPeriod === 'custom' ? 'custom' : 'mo'}`
      )
    }
    return map
  }, [subscriptions])

  const connected = accounts.filter((account) => account.profileReady).length
  const live = accounts.filter((account) => providerByAccount.get(account.id)?.status === 'available').length

  return (
    <SectionCard
      title="Account health"
      description={`${accounts.length} tracked · ${connected} connected · ${live} live`}
      chip={<span className="profile-measurement-chip">Official</span>}
    >
      {accounts.length === 0 ? (
        <div className="profile-empty-state">Add an AI account to start collecting account statistics.</div>
      ) : (
        <div className="profile-account-list">
          {accounts.map((account) => (
            <AccountHealth
              key={account.id}
              account={account}
              provider={providerByAccount.get(account.id)}
              records={historyByAccount.get(account.id) ?? []}
              subscriptionLabel={subscriptionByAccount.get(account.id) ?? null}
            />
          ))}
        </div>
      )}
      <p className="profile-cost-note">
        Usage windows, plan and credits come from each CLI's official usage output. Renewal dates
        and balances are never inferred.
      </p>
    </SectionCard>
  )
}
