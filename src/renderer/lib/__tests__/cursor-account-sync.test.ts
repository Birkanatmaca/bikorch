import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiAccount } from '@shared/contracts/accounts'
import type { CliUsageInfo, CliUsageResponse } from '@shared/contracts/usage'
import { useAiAccountsStore } from '../../stores/ai-accounts-store'
import { useUsageStore } from '../../stores/usage-store'
import { checkAccountUsage, invalidateAccountUsage } from '../usage-sync'
import { syncDiscoveredSystemAccounts } from '../system-auth-sync'

vi.mock('../developer-events', () => ({ recordDeveloperEvent: vi.fn() }))

function account(id: string): AiAccount {
  return { id, kind: 'cursor', name: id, email: `${id}@example.com`, plan: '', note: '',
    createdAt: Date.now(), source: 'manual', lastSeenAt: null, profileReady: true, lastAuthenticatedAt: null }
}
function provider(id: string, usedPercent = 20): CliUsageInfo {
  return { kind: 'cursor', label: 'Cursor CLI', accountId: id, accountEmail: `${id}@example.com`,
    identityVerified: true, status: 'available', detail: 'Verified usage', primary: { usedPercent, windowDurationMins: 43200, resetsAt: null } }
}
function response(...providers: CliUsageInfo[]): CliUsageResponse { return { checkedAt: Date.now(), providers } }

beforeEach(() => {
  useAiAccountsStore.getState().hydrate({ accounts: [account('a'), account('b')] })
  useUsageStore.getState().hydrate(undefined)
})
afterEach(() => vi.unstubAllGlobals())

describe('Cursor account usage lifecycle', () => {
  it('discards a late response after logout while another account completes independently', async () => {
    let resolveA!: (value: CliUsageResponse) => void
    const waitA = new Promise<CliUsageResponse>((resolve) => { resolveA = resolve })
    const read = vi.fn(async ({ accounts }) => accounts[0].accountId === 'a' ? waitA : response(provider('b', 70)))
    vi.stubGlobal('window', { api: { usage: { read } } })
    const taskA = checkAccountUsage(account('a'))
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    await checkAccountUsage(account('b'))
    expect(useUsageStore.getState().providers[0].accountId).toBe('b')
    invalidateAccountUsage('a')
    useAiAccountsStore.getState().markAccountLoggedOut('a')
    useUsageStore.getState().removeAccount('a')
    resolveA(response(provider('a')))
    await taskA
    expect(useUsageStore.getState().providers.map((p) => p.accountId)).toEqual(['b'])
    expect(useUsageStore.getState().history.every((p) => p.accountId === 'b')).toBe(true)
    expect(useUsageStore.getState().checkedAtByAccountId.a).toBeUndefined()
  })

  it('rejects another account identity even if a response carries the requested card ID', async () => {
    vi.stubGlobal('window', { api: { usage: { read: vi.fn(async () => response({ ...provider('a'), accountEmail: 'b@example.com' })) } } })
    await checkAccountUsage(account('a'))
    expect(useUsageStore.getState().providers).toEqual([])
    expect(useAiAccountsStore.getState().accounts[0].email).toBe('a@example.com')
  })

  it('deduplicates repeated checks until the first check finishes', async () => {
    let resolve!: (value: CliUsageResponse) => void
    const wait = new Promise<CliUsageResponse>((done) => { resolve = done })
    const read = vi.fn(() => wait)
    vi.stubGlobal('window', { api: { usage: { read } } })
    const first = checkAccountUsage(account('a')), second = checkAccountUsage(account('a'))
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    resolve(response(provider('a')))
    await Promise.all([first, second])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('removes legacy unverified Cursor metrics and history on hydration', () => {
    const now = Date.now()
    useUsageStore.getState().hydrate({ providers: [{ ...provider('a'), identityVerified: undefined }, provider('b')],
      history: [{ accountId: 'a', kind: 'cursor', checkedAt: now, status: 'available', primaryUsedPercent: 90 },
        { accountId: 'b', kind: 'cursor', identityVerified: true, checkedAt: now, status: 'available', primaryUsedPercent: 20 }] })
    expect(useUsageStore.getState().providers.map((p) => p.accountId)).toEqual(['b'])
    expect(useUsageStore.getState().history.map((p) => p.accountId)).toEqual(['b'])
  })

  it('does not present the previous quota as live when a new Cursor check fails', () => {
    useUsageStore.getState().applyResponse(response(provider('a'), provider('b')), ['a', 'b'])
    useUsageStore.getState().applyResponse(response({ kind: 'cursor', label: 'Cursor CLI', accountId: 'a',
      status: 'error', identityVerified: false, detail: 'Offline' }), ['a'])
    expect(useUsageStore.getState().providers.find((p) => p.accountId === 'a')?.primary).toBeUndefined()
    expect(useUsageStore.getState().providers.find((p) => p.accountId === 'b')?.primary?.usedPercent).toBe(20)
  })

  it('does not recreate logged-out Cursor accounts from the system login on startup', async () => {
    useAiAccountsStore.getState().hydrate({ accounts: [{ ...account('a'), profileReady: false }] })
    const importCurrent = vi.fn()
    vi.stubGlobal('window', { api: { authProfiles: { importCurrent,
      discoverSystem: vi.fn(async () => [{ kind: 'cursor', ready: true, email: 'a@example.com', name: 'a' }]) } } })
    await syncDiscoveredSystemAccounts()
    expect(importCurrent).not.toHaveBeenCalled()
    expect(useAiAccountsStore.getState().accounts).toHaveLength(1)
    expect(useAiAccountsStore.getState().accounts[0].profileReady).toBe(false)
  })
})
