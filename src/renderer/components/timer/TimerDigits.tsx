import { cn } from '@renderer/lib/utils'
import { formatTimerClock } from '@shared/contracts/timer'

export function TimerDigits({
  ms,
  running,
  size = 'md'
}: {
  ms: number
  running?: boolean
  size?: 'sm' | 'md' | 'lg'
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'timer-digits',
        size === 'sm' && 'is-sm',
        size === 'lg' && 'is-lg',
        running && 'is-live'
      )}
    >
      {formatTimerClock(ms)}
    </span>
  )
}
