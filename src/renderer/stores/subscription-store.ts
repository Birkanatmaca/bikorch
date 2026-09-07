import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type {
  SubscriptionBillingPeriod,
  SubscriptionRecord
} from '@shared/contracts/persistence'

export type SubscriptionDraft = Omit<SubscriptionRecord, 'id' | 'source'> & {
  source?: SubscriptionRecord['source']
}

interface SubscriptionStore {
  subscriptions: SubscriptionRecord[]
  hydrate: (subscriptions: SubscriptionRecord[] | undefined) => void
  getSnapshot: () => SubscriptionRecord[]
  addSubscription: (draft: SubscriptionDraft) => string
  updateSubscription: (id: string, updates: Partial<SubscriptionDraft>) => void
  removeSubscription: (id: string) => void
}

function normalizePeriod(value: unknown): SubscriptionBillingPeriod {
  return value === 'yearly' || value === 'custom' ? value : 'monthly'
}

function normalizeSubscription(
  draft: Partial<SubscriptionDraft> & Pick<SubscriptionRecord, 'provider' | 'amount'>,
  existing?: SubscriptionRecord
): SubscriptionRecord {
  const amount = Number.isFinite(draft.amount) ? Math.max(0, draft.amount) : 0
  const currency = typeof draft.currency === 'string' && draft.currency.trim()
    ? draft.currency.trim().toUpperCase().slice(0, 8)
    : existing?.currency ?? 'USD'
  const provider = draft.provider.trim() || existing?.provider || 'AI provider'

  return {
    id: existing?.id ?? uuidv4(),
    ...(typeof draft.accountId === 'string' && draft.accountId ? { accountId: draft.accountId } : {}),
    provider,
    ...(typeof draft.planName === 'string' && draft.planName.trim()
      ? { planName: draft.planName.trim() }
      : {}),
    amount,
    currency,
    billingPeriod: normalizePeriod(draft.billingPeriod),
    ...(typeof draft.renewalDate === 'number' && Number.isFinite(draft.renewalDate)
      ? { renewalDate: draft.renewalDate }
      : {}),
    source: draft.source === 'provider' ? 'provider' : existing?.source ?? 'manual'
  }
}

export const useSubscriptionStore = create<SubscriptionStore>((set, get) => ({
  subscriptions: [],

  hydrate: (subscriptions) => {
    set({ subscriptions: Array.isArray(subscriptions) ? subscriptions : [] })
  },

  getSnapshot: () => get().subscriptions,

  addSubscription: (draft) => {
    const subscription = normalizeSubscription(draft)
    set((state) => ({ subscriptions: [...state.subscriptions, subscription] }))
    return subscription.id
  },

  updateSubscription: (id, updates) => {
    set((state) => ({
      subscriptions: state.subscriptions.map((subscription) =>
        subscription.id === id
          ? normalizeSubscription({ ...subscription, ...updates }, subscription)
          : subscription
      )
    }))
  },

  removeSubscription: (id) => {
    set((state) => ({
      subscriptions: state.subscriptions.filter((subscription) => subscription.id !== id)
    }))
  }
}))
