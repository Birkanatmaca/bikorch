import type { CliUsageBreakdown, CliUsageInfo, CliUsageWindow } from '@shared/contracts/usage'
import {
  CursorAccountError, cursorDashboardRequest, cursorExpectedIdentity,
  prepareCursorProfile, readCursorProfileTokens, verifyCursorIdentity, withCursorAccountLock
} from '../accounts/cursor-profile'

type JsonRecord = Record<string, unknown>
const inFlight = new Map<string, Promise<CliUsageInfo>>()
let activeChecks = 0
const waiting: Array<() => void> = []

async function withCheckSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeChecks >= 3) await new Promise<void>((resolve) => waiting.push(resolve))
  else activeChecks++
  try { return await task() }
  finally {
    const next = waiting.shift()
    if (next) next()
    else activeChecks--
  }
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' ? value as JsonRecord : undefined
}
function number(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined
}
const clamp = (value: number) => Math.min(100, Math.max(0, value))

function usageWindow(label: string, usedPercent: number, start?: number, end?: number): CliUsageWindow {
  return {
    label,
    usedPercent: clamp(usedPercent),
    windowDurationMins: end && start && end > start ? (end - start) / 60000 : 43200,
    resetsAt: end && end > 0 ? Math.floor(end / 1000) : null
  }
}

function percentLine(label: string, used: number): CliUsageBreakdown {
  return { label, value: `${used.toFixed(1)}% used`, usedPercent: clamp(used) }
}

export function parseCursorDashboardUsage(
  usage: JsonRecord,
  planResponse: JsonRecord,
  hardLimit: JsonRecord
): Pick<CliUsageInfo, 'status' | 'detail' | 'planType' | 'primary' | 'secondary' | 'breakdown'> {
  const plan = record(usage.planUsage)
  const planInfo = record(planResponse.planInfo)
  const planType = typeof planInfo?.planName === 'string' ? planInfo.planName : null
  if (!plan) return { status: 'unavailable', detail: 'Cursor bu plan için limit bilgisi sunmuyor.', planType }
  const cursorModels = number(plan.autoPercentUsed)
  const otherModels = number(plan.apiPercentUsed)
  const included = number(plan.totalPercentUsed) ??
    ((number(plan.limit) ?? 0) > 0 ? (number(plan.includedSpend) ?? 0) / Number(plan.limit) * 100 : 0)
  const end = number(usage.billingCycleEnd) ?? number(planInfo?.billingCycleEnd)
  const start = number(usage.billingCycleStart)
  const primary = usageWindow(
    cursorModels !== undefined ? 'Cursor Models' : 'Included usage',
    cursorModels ?? included,
    start,
    end
  )
  const secondary = otherModels !== undefined
    ? usageWindow('Other Models', otherModels, start, end)
    : undefined
  const breakdown: CliUsageBreakdown[] = [
    percentLine(primary.label ?? 'Included', primary.usedPercent),
    ...(secondary ? [percentLine(secondary.label ?? 'Other Models', secondary.usedPercent)] : []),
    ...(cursorModels !== undefined && included !== cursorModels
      ? [percentLine('Included', included)]
      : [])
  ]
  const spend = record(usage.spendLimitUsage)
  const spent = (number(spend?.individualUsed) ?? 0) / 100
  const limitCents = number(spend?.individualLimit)
  const limit = limitCents === undefined ? number(hardLimit.hardLimit) : limitCents / 100
  breakdown.push({ label: 'On-Demand', value: hardLimit.noUsageBasedAllowed === true || limit === 0
    ? 'Disabled' : limit !== undefined && limit < 2147483647 ? `$${spent.toFixed(2)} / $${limit.toFixed(2)}` : `$${spent.toFixed(2)} used` })
  return {
    status: 'available',
    detail: 'Bu hesabın doğrulanmış canlı Cursor kullanımı.',
    planType,
    breakdown,
    primary,
    ...(secondary ? { secondary } : {})
  }
}

async function read(accountId: string): Promise<CliUsageInfo> {
  const base = { kind: 'cursor' as const, label: 'Cursor CLI', accountId, identityVerified: false }
  try {
    if (!await prepareCursorProfile(accountId)) {
      return { ...base, status: 'unavailable', detail: 'Bu hesap için ayrı oturum kaydedilmemiş. Login ile bağlayın.' }
    }
    const tokens = readCursorProfileTokens(accountId)
    if (!tokens) throw new CursorAccountError('Bu hesaba giriş yapın.', true)
    // Every response uses one immutable token. Labels never stand in for authentication.
    const [identity, usage, plan, hardLimit] = await Promise.all([
      verifyCursorIdentity(tokens.accessToken, cursorExpectedIdentity(accountId)),
      cursorDashboardRequest(tokens.accessToken, 'GetCurrentPeriodUsage'),
      cursorDashboardRequest(tokens.accessToken, 'GetPlanInfo').catch(() => ({})),
      cursorDashboardRequest(tokens.accessToken, 'GetHardLimit').catch(() => ({}))
    ])
    const current = readCursorProfileTokens(accountId)
    if (current?.accessToken !== tokens.accessToken) {
      throw new CursorAccountError('Hesap oturumu değişti. Tekrar kontrol edin.')
    }
    return { ...base, ...parseCursorDashboardUsage(usage, plan, hardLimit),
      accountEmail: identity.email, accountName: identity.name, identityVerified: true }
  } catch (error) {
    return { ...base, status: error instanceof CursorAccountError && error.needsLogin ? 'unavailable' : 'error',
      detail: error instanceof Error ? error.message : 'Cursor kullanımı alınamadı.' }
  }
}

export function readCursorAccountUsage(accountId: string): Promise<CliUsageInfo> {
  const existing = inFlight.get(accountId)
  if (existing) return existing
  const result = withCheckSlot(() => withCursorAccountLock(accountId, () => read(accountId)))
  inFlight.set(accountId, result)
  void result.finally(() => { if (inFlight.get(accountId) === result) inFlight.delete(accountId) }).catch(() => undefined)
  return result
}
