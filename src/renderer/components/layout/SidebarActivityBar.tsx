import { Files, Gauge, GitBranch, UsersRound } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

interface SidebarActivityBarProps {
  isOpen: boolean
  view: 'files' | 'changes' | 'limits' | 'accounts'
  changesCount: number
  onSelectFiles: () => void
  onSelectChanges: () => void
  onSelectLimits: () => void
  onSelectAccounts: () => void
}

export function SidebarActivityBar({
  isOpen,
  view,
  changesCount,
  onSelectFiles,
  onSelectChanges,
  onSelectLimits,
  onSelectAccounts
}: SidebarActivityBarProps): React.JSX.Element {
  const filesActive = isOpen && view === 'files'
  const changesActive = isOpen && view === 'changes'
  const limitsActive = isOpen && view === 'limits'
  const accountsActive = isOpen && view === 'accounts'
  const badge = changesCount > 99 ? '99+' : String(changesCount)

  return (
    <aside className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border bg-elevated py-2">
      <button
        type="button"
        onClick={onSelectFiles}
        title={filesActive ? 'Hide files' : 'Show files'}
        aria-label={filesActive ? 'Hide files' : 'Show files'}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
          filesActive
            ? 'bg-primary/15 text-primary'
            : 'text-text-muted hover:bg-hover hover:text-text-primary'
        )}
      >
        <Files className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onSelectAccounts}
        title={accountsActive ? 'Hide AI accounts' : 'Show AI accounts'}
        aria-label={accountsActive ? 'Hide AI accounts' : 'Show AI accounts'}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
          accountsActive
            ? 'bg-primary/15 text-primary'
            : 'text-text-muted hover:bg-hover hover:text-text-primary'
        )}
      >
        <UsersRound className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onSelectLimits}
        title={limitsActive ? 'Hide limits' : 'Show limits'}
        aria-label={limitsActive ? 'Hide limits' : 'Show limits'}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
          limitsActive
            ? 'bg-primary/15 text-primary'
            : 'text-text-muted hover:bg-hover hover:text-text-primary'
        )}
      >
        <Gauge className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onSelectChanges}
        title={changesActive ? 'Hide changes' : 'Show changes'}
        aria-label={changesActive ? 'Hide changes' : 'Show changes'}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-md transition-colors',
          changesActive
            ? 'bg-primary/15 text-primary'
            : 'text-text-muted hover:bg-hover hover:text-text-primary'
        )}
      >
        <GitBranch className="h-4 w-4" />
        {changesCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-warning px-0.5 text-center font-mono text-[8px] leading-3 text-app-bg">
            {badge}
          </span>
        )}
      </button>
    </aside>
  )
}
