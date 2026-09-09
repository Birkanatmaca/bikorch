import { useMemo, useState } from 'react'
import { Pencil, Plus, ReceiptText, Trash2, X } from 'lucide-react'
import type { SubscriptionBillingPeriod, SubscriptionRecord } from '@shared/contracts/persistence'
import { AI_ACCOUNT_LABELS, type AiAccount } from '@shared/contracts/accounts'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { useSubscriptionStore, type SubscriptionDraft } from '@renderer/stores/subscription-store'
import { buttonStyles } from '@renderer/components/ui/Button'
import {
  formatDateInput,
  formatMeasured,
  formatMoney,
  monthlySubscriptionLabel,
  monthlySubscriptionTotals
} from './profile-format'
import { DistributionBars, SectionCard } from './ProfilePrimitives'

function formatRenewalDate(timestamp: number | undefined): string {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleDateString([], { dateStyle: 'medium' })
}

function SubscriptionForm({
  subscription,
  accounts,
  onClose
}: {
  subscription: SubscriptionRecord | null
  accounts: AiAccount[]
  onClose: () => void
}): React.JSX.Element {
  const addSubscription = useSubscriptionStore((state) => state.addSubscription)
  const updateSubscription = useSubscriptionStore((state) => state.updateSubscription)
  const firstAccount = accounts[0]
  const [draft, setDraft] = useState(() => ({
    accountId: subscription?.accountId ?? '',
    provider: subscription?.provider ?? (firstAccount ? AI_ACCOUNT_LABELS[firstAccount.kind] : ''),
    planName: subscription?.planName ?? '',
    amount: subscription ? String(subscription.amount) : '',
    currency: subscription?.currency ?? 'USD',
    billingPeriod: (subscription?.billingPeriod ?? 'monthly') as SubscriptionBillingPeriod,
    renewalDate: formatDateInput(subscription?.renewalDate)
  }))

  const update = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const amount = Number(draft.amount)
    if (!draft.provider.trim() || !Number.isFinite(amount) || amount < 0) return
    const renewalDate = draft.renewalDate ? Date.parse(`${draft.renewalDate}T12:00:00`) : undefined
    const data: SubscriptionDraft = {
      accountId: draft.accountId || undefined,
      provider: draft.provider,
      planName: draft.planName,
      amount,
      currency: draft.currency,
      billingPeriod: draft.billingPeriod,
      renewalDate: renewalDate && Number.isFinite(renewalDate) ? renewalDate : undefined,
      source: 'manual'
    }
    if (subscription) updateSubscription(subscription.id, data)
    else addSubscription(data)
    onClose()
  }

  return (
    <div className="profile-form-overlay">
      <form onSubmit={submit} className="profile-subscription-form">
        <div className="profile-form-heading">
          <div className="profile-panel-icon"><ReceiptText className="h-3.5 w-3.5" /></div>
          <div className="min-w-0 flex-1">
            <h3>{subscription ? 'Edit subscription' : 'Add subscription'}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })}
            aria-label="Close subscription form"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="profile-form-fields">
          <label>
            <span>Linked account (optional)</span>
            <select
              value={draft.accountId}
              onChange={(event) => {
                const accountId = event.target.value
                update('accountId', accountId)
                const account = accounts.find((candidate) => candidate.id === accountId)
                if (account) update('provider', AI_ACCOUNT_LABELS[account.kind])
              }}
            >
              <option value="">No specific account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {AI_ACCOUNT_LABELS[account.kind]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Provider</span>
            <input
              value={draft.provider}
              onChange={(event) => update('provider', event.target.value)}
              placeholder="Claude, Cursor, ChatGPT…"
              required
            />
          </label>
          <label>
            <span>Plan name</span>
            <input
              value={draft.planName}
              onChange={(event) => update('planName', event.target.value)}
              placeholder="Pro, Plus…"
            />
          </label>
          <div className="profile-form-row">
            <label>
              <span>Price</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.amount}
                onChange={(event) => update('amount', event.target.value)}
                placeholder="20"
                required
              />
            </label>
            <label>
              <span>Currency</span>
              <select value={draft.currency} onChange={(event) => update('currency', event.target.value)}>
                {['USD', 'EUR', 'TRY', 'GBP'].map((currency) => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="profile-form-row">
            <label>
              <span>Billing period</span>
              <select
                value={draft.billingPeriod}
                onChange={(event) => update('billingPeriod', event.target.value as SubscriptionBillingPeriod)}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label>
              <span>Renewal date</span>
              <input
                type="date"
                value={draft.renewalDate}
                onChange={(event) => update('renewalDate', event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="profile-form-actions">
          <button type="button" onClick={onClose} className={buttonStyles()}>Cancel</button>
          <button type="submit" className={buttonStyles({ variant: 'primary' })}>
            {subscription ? 'Save subscription' : 'Add subscription'}
          </button>
        </div>
      </form>
    </div>
  )
}

function SubscriptionRow({
  subscription,
  account,
  onEdit,
  onRemove
}: {
  subscription: SubscriptionRecord
  account: AiAccount | undefined
  onEdit: () => void
  onRemove: () => void
}): React.JSX.Element {
  const cadence =
    subscription.billingPeriod === 'yearly' ? 'yearly' : subscription.billingPeriod === 'custom' ? 'custom' : 'monthly'

  return (
    <article className="profile-subscription-row">
      <div className="profile-subscription-icon"><ReceiptText className="h-3.5 w-3.5" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <strong className="truncate text-[11px] text-text-primary">
            {subscription.planName || subscription.provider}
          </strong>
          <span className="profile-subscription-source">{subscription.source}</span>
        </div>
        <p className="truncate text-[9px] text-text-muted">
          {subscription.provider}{account ? ` · ${account.name}` : ''}
          {subscription.renewalDate ? ` · ${formatRenewalDate(subscription.renewalDate)}` : ''}
        </p>
      </div>
      <div className="profile-subscription-price">
        <strong>{formatMoney(subscription.amount, subscription.currency)}</strong>
        <span>{cadence}</span>
      </div>
      <div className="profile-subscription-actions">
        <button type="button" onClick={onEdit} className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })} aria-label="Edit subscription" title="Edit subscription">
          <Pencil className="h-3 w-3" />
        </button>
        <button type="button" onClick={onRemove} className={buttonStyles({ variant: 'danger', size: 'icon-sm' })} aria-label="Remove subscription" title="Remove subscription">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </article>
  )
}

export function AiCosts(): React.JSX.Element {
  const accounts = useAiAccountsStore((state) => state.accounts)
  const subscriptions = useSubscriptionStore((state) => state.subscriptions)
  const removeSubscription = useSubscriptionStore((state) => state.removeSubscription)
  const metrics = useDeveloperIntelligenceStore((state) => state.metrics)
  const [subscriptionForm, setSubscriptionForm] = useState<SubscriptionRecord | null | undefined>(undefined)

  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])

  const providerBreakdown = useMemo(() => {
    const totals = monthlySubscriptionTotals(subscriptions)
    if (totals.size !== 1) return []
    const byProvider = new Map<string, number>()
    for (const subscription of subscriptions) {
      const monthly =
        subscription.billingPeriod === 'monthly'
          ? subscription.amount
          : subscription.billingPeriod === 'yearly'
            ? subscription.amount / 12
            : null
      if (monthly === null) continue
      byProvider.set(subscription.provider, (byProvider.get(subscription.provider) ?? 0) + monthly)
    }
    const total = [...byProvider.values()].reduce((sum, value) => sum + value, 0)
    return [...byProvider.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, weight]) => ({ label, weight, percent: Math.round((weight / total) * 1000) / 10 }))
  }, [subscriptions])

  const apiSpend = metrics?.overview.apiSpendUsd ?? { value: null, availability: 'unavailable' as const }

  return (
    <>
      <SectionCard title="Costs">
        <div className="profile-cost-grid">
          <div>
            <span>Subscriptions</span>
            <strong>{monthlySubscriptionLabel(subscriptions)}</strong>
          </div>
          <div>
            <span>API</span>
            <strong>{formatMeasured(apiSpend, (value) => `$${value.toFixed(2)}`)}</strong>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Plans"
        className="mt-2.5"
        action={
          <button
            type="button"
            onClick={() => setSubscriptionForm(null)}
            className={buttonStyles({ variant: 'secondary', size: 'sm' })}
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        }
      >
        {subscriptions.length === 0 ? (
          <div className="profile-empty-state">None</div>
        ) : (
          <div className="profile-subscription-list">
            {subscriptions.map((subscription) => (
              <SubscriptionRow
                key={subscription.id}
                subscription={subscription}
                account={subscription.accountId ? accountsById.get(subscription.accountId) : undefined}
                onEdit={() => setSubscriptionForm(subscription)}
                onRemove={() => {
                  if (window.confirm(`Remove ${subscription.planName || subscription.provider} subscription?`)) {
                    removeSubscription(subscription.id)
                  }
                }}
              />
            ))}
          </div>
        )}
        {providerBreakdown.length > 1 && (
          <>
            <h4 className="profile-subheading">By provider</h4>
            <DistributionBars entries={providerBreakdown} />
          </>
        )}
      </SectionCard>

      {subscriptionForm !== undefined && (
        <SubscriptionForm
          subscription={subscriptionForm}
          accounts={accounts}
          onClose={() => setSubscriptionForm(undefined)}
        />
      )}
    </>
  )
}
