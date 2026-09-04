import type { AiAccount } from '@shared/contracts/accounts'
import {
  AI_ACCOUNT_AUTHENTICATED_EVENT,
  AI_ACCOUNTS_REFRESH_EVENT
} from '@renderer/lib/app-events'
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
const pendingIds = new Set<string>()

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
    if (!started) return
    try {
      const response = await window.api.usage.read({
        accounts: [{ kind: account.kind, accountId: account.id }]
      })
      useUsageStore.getState().applyResponse(response, [account.id])
    } catch {
      useUsageStore.getState().markChecked([account.id])
    }
  }
}

function enqueue(accounts: AiAccount[]): Promise<void> {
  const next = accounts.filter((account) => !pendingIds.has(account.id))
  if (next.length === 0) return Promise.resolve()
  for (const account of next) pendingIds.add(account.id)

  const run = async (): Promise<void> => {
    try {
      await readAccounts(next)
    } finally {
      for (const account of next) pendingIds.delete(account.id)
    }
  }

  const queued = queue.then(run, run)
  queue = queued.then(
    () => undefined,
    () => undefined
  )
  return queued
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
    tick()
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
