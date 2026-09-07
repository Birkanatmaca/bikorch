import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { DistributionEntry, MetricAvailability } from '@shared/contracts/developer-intelligence'
import { cn } from '@renderer/lib/utils'

export function SectionCard({
  title,
  description,
  action,
  chip,
  children,
  className
}: {
  title: string
  description?: string
  action?: ReactNode
  chip?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section className={cn('profile-insight-card', className)}>
      <div className="profile-section-heading">
        <div className="min-w-0">
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {action}
        {chip}
      </div>
      {children}
    </section>
  )
}

export function StatCard({
  icon: Icon,
  label,
  value,
  delta,
  muted
}: {
  icon: LucideIcon
  label: string
  value: string
  delta?: string | null
  muted?: boolean
}): React.JSX.Element {
  const negative = delta?.startsWith('-')
  return (
    <div className={cn('profile-stat-card', muted && 'profile-stat-card-muted')}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span>{label}</span>
      <strong>
        {value}
        {delta && (
          <em className={cn('profile-stat-delta', negative ? 'profile-stat-delta-down' : 'profile-stat-delta-up')}>
            {delta}
          </em>
        )}
      </strong>
    </div>
  )
}

export function AvailabilityChip({ availability }: { availability: MetricAvailability }): React.JSX.Element {
  const label = availability === 'measured' ? 'Measured' : availability === 'estimated' ? 'Estimated' : 'Unavailable'
  return <span className={cn('profile-measurement-chip', `profile-availability-${availability}`)}>{label}</span>
}

export function DistributionBars({
  entries,
  labelFor = (label) => label,
  emptyLabel = 'No data in this range'
}: {
  entries: DistributionEntry[]
  labelFor?: (label: string) => string
  emptyLabel?: string
}): React.JSX.Element {
  if (entries.length === 0) return <div className="profile-empty-state">{emptyLabel}</div>
  const max = Math.max(...entries.map((entry) => entry.percent), 1)
  return (
    <div className="profile-bars">
      {entries.map((entry) => (
        <div key={entry.label} className="profile-bar-row">
          <span className="profile-bar-label" title={labelFor(entry.label)}>{labelFor(entry.label)}</span>
          <span className="profile-bar-track">
            <span className="profile-bar-fill" style={{ width: `${(entry.percent / max) * 100}%` }} />
          </span>
          <span className="profile-bar-value">{entry.percent.toFixed(entry.percent < 10 ? 1 : 0)}%</span>
        </div>
      ))}
    </div>
  )
}

export function KeyValueList({
  items
}: {
  items: Array<{ label: string; value: string; hint?: string }>
}): React.JSX.Element {
  return (
    <dl className="profile-kv-list">
      {items.map((item) => (
        <div key={item.label} className="profile-kv-row">
          <dt>
            {item.label}
            {item.hint && <small>{item.hint}</small>}
          </dt>
          <dd className={cn(item.value === 'Unavailable' && 'profile-kv-unavailable')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Sparkline({
  points,
  label
}: {
  points: Array<{ day: string; count: number }>
  label: string
}): React.JSX.Element | null {
  if (points.length === 0) return null
  const max = Math.max(...points.map((point) => point.count), 1)
  const total = points.reduce((sum, point) => sum + point.count, 0)
  return (
    <div className="profile-sparkline" role="img" aria-label={`${label}: ${total} over ${points.length} days`}>
      {points.map((point) => (
        <span
          key={point.day}
          className={cn('profile-sparkline-col', point.count === 0 && 'profile-sparkline-col-empty')}
          style={{ height: `${Math.max(6, (point.count / max) * 100)}%` }}
          title={`${point.day}: ${point.count}`}
        />
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  ariaLabel,
  description,
  disabled
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** Visible label. Pass `ariaLabel` instead for compact, icon-only rows. */
  label?: string
  ariaLabel?: string
  description?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label
      className={cn('profile-toggle', !label && 'profile-toggle-compact', disabled && 'profile-toggle-disabled')}
      title={label ? undefined : ariaLabel}
    >
      {label && (
        <span className="min-w-0 flex-1">
          <span className="profile-toggle-label">{label}</span>
          {description && <span className="profile-toggle-description">{description}</span>}
        </span>
      )}
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-label={label ? undefined : ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="profile-toggle-switch" aria-hidden />
    </label>
  )
}
