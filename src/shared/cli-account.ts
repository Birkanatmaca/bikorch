import type { AiAccount } from './contracts/accounts'
import type { CliUsageInfo, CliUsageKind } from './contracts/usage'

export function usagePressure(provider: CliUsageInfo | undefined): number {
  if (!provider) return 50
  if (provider.status !== 'available') return 101
  const percents = [
    provider.primary?.usedPercent,
    provider.secondary?.usedPercent,
    ...(provider.breakdown ?? []).map((item) => item.usedPercent)
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (percents.length === 0) return 50
  return Math.max(...percents)
}

export function pickCliAccountId(
  kind: CliUsageKind,
  accounts: Pick<AiAccount, 'id' | 'kind' | 'profileReady'>[],
  usage: CliUsageInfo[],
  preferredId?: string | null
): string | undefined {
  const ready = accounts.filter((account) => account.kind === kind && account.profileReady)
  if (ready.length === 0) return preferredId || undefined

  const pressureFor = (id: string): number =>
    usagePressure(usage.find((provider) => provider.accountId === id && provider.kind === kind))

  const ranked = [...ready].sort((left, right) => pressureFor(left.id) - pressureFor(right.id))
  const preferred = preferredId ? ranked.find((account) => account.id === preferredId) : undefined
  if (preferred && pressureFor(preferred.id) < 99) return preferred.id
  return ranked[0]?.id
}
