import {
  AI_ACCOUNT_LABELS,
  type AiAccount
} from '@shared/contracts/accounts'
import type { SystemAuthDiscovery } from '@shared/contracts/auth-profiles'
import type { CliUsageKind } from '@shared/contracts/usage'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function findMatchingAccount(
  accounts: AiAccount[],
  discovery: SystemAuthDiscovery
): AiAccount | undefined {
  const kindAccounts = accounts.filter(
    (account) => account.kind === discovery.kind && account.profileReady
  )
  if (kindAccounts.length === 0) return undefined

  if (discovery.email) {
    const targetEmail = normalizeEmail(discovery.email)
    return kindAccounts.find((account) => normalizeEmail(account.email) === targetEmail)
  }

  return kindAccounts[0]
}

async function importDiscovery(discovery: SystemAuthDiscovery): Promise<AiAccount | null> {
  const store = useAiAccountsStore.getState()
  const existing = findMatchingAccount(store.accounts, discovery)
  if (existing) return existing

  const accountId = store.addAccount({
    kind: discovery.kind,
    name: discovery.name || `${AI_ACCOUNT_LABELS[discovery.kind]} account`,
    email: discovery.email,
    plan: '',
    note: ''
  })

  try {
    const result = await window.api.authProfiles.importCurrent({
      kind: discovery.kind,
      accountId,
      ...(discovery.email ? { email: discovery.email } : {})
    })

    if (!result.ok || !result.ready) {
      store.removeAccount(accountId)
      return null
    }

    store.markAccountAuthenticated(accountId, result.identity)
    const profiles = await window.api.authProfiles.list()
    store.syncAuthProfiles(profiles)

    const imported = useAiAccountsStore
      .getState()
      .accounts.find((account) => account.id === accountId)
    return imported ?? null
  } catch {
    store.removeAccount(accountId)
    return null
  }
}

export async function syncDiscoveredSystemAccounts(): Promise<void> {
  const discoveries = await window.api.authProfiles.discoverSystem()
  const suppressed = useAiAccountsStore.getState().suppressSystemImportByKind
  for (const discovery of discoveries) {
    if (!discovery.ready || suppressed[discovery.kind]) continue
    await importDiscovery(discovery)
  }
}

export async function importSystemAccountForKind(
  kind: CliUsageKind
): Promise<AiAccount | null> {
  const store = useAiAccountsStore.getState()
  if (store.suppressSystemImportByKind[kind]) return null
  const readyAccounts = store.accounts.filter(
    (account) => account.kind === kind && account.profileReady
  )
  if (readyAccounts.length > 0) return readyAccounts[0]

  const discoveries = await window.api.authProfiles.discoverSystem()
  const discovery = discoveries.find((entry) => entry.kind === kind && entry.ready)
  if (!discovery) return null

  return importDiscovery(discovery)
}
