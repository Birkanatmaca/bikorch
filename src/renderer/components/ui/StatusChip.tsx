import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

export function StatusChip({ children, tone = 'neutral', className }: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'primary'
  className?: string
}): React.JSX.Element {
  return (
    <span className={cn('status-chip', className)} data-tone={tone} title={typeof children === 'string' ? children : undefined}>
      <span className="status-chip-dot" aria-hidden />
      <span className="status-chip-label">{children}</span>
    </span>
  )
}
