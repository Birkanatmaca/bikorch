import { Check, Hand, TriangleAlert } from 'lucide-react'
import { SESSION_SIGNAL_LABEL, formatElapsed, type SessionSignal } from '@renderer/lib/project-activity'
import { useNow } from '@renderer/hooks/use-session-signals'
import { cn } from '@renderer/lib/utils'

/**
 * The status mark used everywhere a session shows up: a spinning ring while
 * working, a hand when it needs you, a check when done, a triangle on error.
 */
export function SignalIcon({ signal, className }: { signal: SessionSignal; className?: string }): React.JSX.Element {
  return (
    <span className={cn('signal-icon', `is-${signal}`, className)} aria-hidden>
      {signal === 'asking' && <Hand strokeWidth={2.4} />}
      {signal === 'done' && <Check strokeWidth={3} />}
      {signal === 'error' && <TriangleAlert strokeWidth={2.4} />}
    </span>
  )
}

/** Header chip: icon, label and, while working, how long it has run. */
export function SessionBadge({ signal, since }: { signal: SessionSignal; since?: number }): React.JSX.Element | null {
  const now = useNow(15_000, signal === 'working' && since !== undefined)
  if (signal === 'idle' || signal === 'off') return null
  const label = SESSION_SIGNAL_LABEL[signal]
  const elapsed = signal === 'working' && since ? formatElapsed(since, now) : null
  return (
    <span className={cn('session-badge', `is-${signal}`)} title={elapsed ? `${label} for ${elapsed}` : label} role="status">
      <SignalIcon signal={signal} />
      <span className="session-badge-label">{label}</span>
      {elapsed && <span className="session-badge-time">{elapsed}</span>}
    </span>
  )
}
