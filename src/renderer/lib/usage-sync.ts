import type { AiAccount } from '@shared/contracts/accounts'
import {
  AI_ACCOUNT_AUTHENTICATED_EVENT,
  AI_ACCOUNTS_REFRESH_EVENT
} from '@renderer/lib/app-events'
import { recordDeveloperEvent } from '@renderer/lib/developer-events'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useUsageStore } from '@renderer/stores/usage-store'
import type { CliUsageKind } from '@shared/contracts/usage'

const CHECK_INTERVAL_MS = 60_000
const TICK_MS = 5_000
const START_DELAY_MS = 2_000

let started = false
let tickTimer: ReturnType<typeof setInterval> | null = null
let startTimer: ReturnType<typeof setTimeout> | null = null
let queue: Promise<void> = Promise.resolve()
const pending = new Map<string, Promise<void>>()
const revisions = new Map<string, number>()

export function invalidateAccountUsage(accountId: string): void {
  revisions.set(accountId, (revisions.get(accountId) ?? 0) + 1)
}

function readyAccounts(): AiAccount[] {
  return useAiAccountsStore.getState().accounts.filter((account) => account.profileReady)
}

function dueAccounts(force = false): AiAccount[] {
  const now = Date.now()
  const checkedAtByAccountId = useUsageStore.getState().checkedAtByAccountId
  return readyAccounts().filter((account) => {
    if (force) return true
    const lastChecked = checkedAtByAccountId[account.id] ?? 0
    return now - lastChecked >= CHECK_INTERVAL_MS
  })
}

async function readAccounts(accounts: AiAccount[]): Promise<void> {
  if (accounts.length === 0) return

  for (const account of accounts) {
    const revision = revisions.get(account.id) ?? 0
    if (!useAiAccountsStore.getState().accounts.some((item) => item.id === account.id && item.profileReady)) continue
    try {
      const response = await window.api.usage.read({
        accounts: [{ kind: account.kind, accountId: account.id }]
      })
      const current = useAiAccountsStore.getState().accounts.find((item) => item.id === account.id)
      if (!current?.profileReady || (revisions.get(account.id) ?? 0) !== revision) continue
      const returned = response.providers.find((item) => item.accountId === account.id && item.kind === account.kind)
      if (account.kind === 'cursor' && returned?.status === 'available' &&
        (returned.identityVerified !== true || !returned.accountEmail ||
          (current.email && returned.accountEmail.toLowerCase() !== current.email.toLowerCase()))) {
        useUsageStore.getState().removeAccount(account.id)
        continue
      }
      useUsageStore.getState().applyResponse(response, [account.id])
      const provider = response.providers.find((item) => item.accountId === account.id)
      if (!provider) continue
      if (provider.status === 'available') recordDeveloperEvent({
        type: 'usage.snapshot',
        provider: account.kind,
        accountId: account.id,
        payload: {
          kind: account.kind as CliUsageKind,
          primaryUsedPercent: provider.primary?.usedPercent ?? null,
          ...(provider.secondary?.usedPercent !== undefined
            ? { secondaryUsedPercent: provider.secondary.usedPercent }
            : {}),
          ...(provider.planType ? { planType: provider.planType } : {})
        }
      })
      const incomingEmail = provider.accountEmail?.trim()
      const existingEmail = account.email.trim()
      const emailMatches =
        !incomingEmail ||
        !existingEmail ||
        incomingEmail.toLowerCase() === existingEmail.toLowerCase()
      if (emailMatches && (incomingEmail || provider.planType)) {
        useAiAccountsStore.getState().updateAccount(account.id, {
          ...(incomingEmail && !existingEmail ? { email: incomingEmail } : {}),
          ...(provider.planType ? { plan: provider.planType } : {})
        })
      }
    } catch {
      if ((revisions.get(account.id) ?? 0) === revision &&
        useAiAccountsStore.getState().accounts.some((item) => item.id === account.id && item.profileReady)) {
        useUsageStore.getState().markChecked([account.id])
      }
    }
  }
}

function enqueue(accounts: AiAccount[]): Promise<void> {
  const tasks = accounts.map((account) => {
    const existing = pending.get(account.id)
    if (existing) return existing
    const revision = revisions.get(account.id) ?? 0
    const run = async (): Promise<void> => {
      if ((revisions.get(account.id) ?? 0) === revision) await readAccounts([account])
    }
    // Cursor requests are isolated and can finish while shared-store CLIs wait in their queue.
    const task = account.kind === 'cursor' ? Promise.resolve().then(run) : queue.then(run, run)
    if (account.kind !== 'cursor') queue = task.catch(() => undefined)
    pending.set(account.id, task)
    void task.finally(() => { if (pending.get(account.id) === task) pending.delete(account.id) }).catch(() => undefined)
    return task
  })
  return Promise.all(tasks).then(() => undefined)
}

function tick(force = false): void {
  void enqueue(dueAccounts(force))
}

function handleAuthenticated(event: Event): void {
  const detail = (
    event as CustomEvent<{
      accountId: string
      kind: CliUsageKind
      identity?: { email?: string; name?: string }
    }>
  ).detail
  if (!detail?.accountId) return

  const store = useAiAccountsStore.getState()
  store.markAccountAuthenticated(detail.accountId, detail.identity)
  store.setActiveAccount(detail.kind, detail.accountId)

  window.setTimeout(() => {
    const account = useAiAccountsStore
      .getState()
      .accounts.find((candidate) => candidate.id === detail.accountId)
    if (account?.profileReady) void enqueue([account])
  }, 800)
}

export function startUsageSync(): () => void {
  if (started) return () => undefined
  started = true

  const onRefresh = (): void => {
    window.setTimeout(() => tick(), 800)
  }

  window.addEventListener(AI_ACCOUNT_AUTHENTICATED_EVENT, handleAuthenticated)
  window.addEventListener(AI_ACCOUNTS_REFRESH_EVENT, onRefresh)

  startTimer = setTimeout(() => {
    tick(true)
    tickTimer = setInterval(() => tick(), TICK_MS)
  }, START_DELAY_MS)

  return () => {
    started = false
    if (startTimer) {
      clearTimeout(startTimer)
      startTimer = null
    }
    if (tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
    window.removeEventListener(AI_ACCOUNT_AUTHENTICATED_EVENT, handleAuthenticated)
    window.removeEventListener(AI_ACCOUNTS_REFRESH_EVENT, onRefresh)
  }
}

export function checkAccountUsage(account: AiAccount): Promise<void> {
  return enqueue([account])
}

export function checkAllAccountUsage(): Promise<void> {
  return enqueue(dueAccounts(true))
}
