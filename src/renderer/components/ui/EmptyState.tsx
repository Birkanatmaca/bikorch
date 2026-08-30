import { cn } from '@renderer/lib/utils'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center gap-3 p-6 text-center',
        className
      )}
    >
      {Icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-elevated">
          <Icon className="h-4 w-4 text-text-muted" strokeWidth={1.5} />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs font-medium text-text-secondary">{title}</p>
        {description && (
          <p className="max-w-[220px] text-[11px] leading-relaxed text-text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}
