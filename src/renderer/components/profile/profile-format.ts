import { AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import type { MeasuredNumber } from '@shared/contracts/developer-intelligence'
import type { SubscriptionRecord } from '@shared/contracts/persistence'

export const UNAVAILABLE = 'Unavailable'

export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return UNAVAILABLE
  return new Date(timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

export function formatRelativeDay(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  if (sameDay) return `Today ${date.toLocaleTimeString([], { timeStyle: 'short' })}`
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatPercent(value: number | undefined | null): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${Math.round(Math.max(0, Math.min(100, value)))}%`
    : UNAVAILABLE
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat([]).format(value)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function formatMeasured(
  metric: MeasuredNumber,
  render: (value: number) => string = (value) => formatCount(Math.round(value))
): string {
  if (metric.availability === 'unavailable' || metric.value === null) return UNAVAILABLE
  const text = render(metric.value)
  return metric.availability === 'estimated' ? `~${text}` : text
}

export function formatDelta(delta: number | null): string | null {
  if (delta === null || !Number.isFinite(delta)) return null
  const rounded = Math.round(delta)
  if (rounded === 0) return '±0%'
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat([], {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function formatDateInput(timestamp: number | undefined): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function monthlyEquivalent(subscription: SubscriptionRecord): number | null {
  if (subscription.billingPeriod === 'monthly') return subscription.amount
  if (subscription.billingPeriod === 'yearly') return subscription.amount / 12
  return null
}

export function monthlySubscriptionTotals(subscriptions: SubscriptionRecord[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const subscription of subscriptions) {
    const monthly = monthlyEquivalent(subscription)
    if (monthly === null) continue
    totals.set(subscription.currency, (totals.get(subscription.currency) ?? 0) + monthly)
  }
  return totals
}

export function monthlySubscriptionLabel(subscriptions: SubscriptionRecord[]): string {
  const totals = monthlySubscriptionTotals(subscriptions)
  if (totals.size === 0) return UNAVAILABLE
  if (totals.size > 1) return 'Mixed currencies'
  const [currency, total] = [...totals.entries()][0]
  return `${formatMoney(total, currency)} / mo`
}

export function providerLabel(provider: string | null | undefined): string {
  if (!provider) return 'Unknown provider'
  return (AI_ACCOUNT_LABELS as Record<string, string>)[provider] ?? provider
}

export const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  dart: 'Dart',
  php: 'PHP',
  ruby: 'Ruby',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  sql: 'SQL',
  shell: 'Shell',
  powershell: 'PowerShell',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  html: 'HTML',
  graphql: 'GraphQL',
  dockerfile: 'Dockerfile',
  groovy: 'Groovy',
  yaml: 'YAML',
  json: 'JSON',
  markdown: 'Markdown',
  unknown: 'Unknown'
}

export function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? language
}
