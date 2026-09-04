import { Files, GitBranch, UsersRound } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

interface SidebarActivityBarProps {
  isOpen: boolean
  view: 'files' | 'changes' | 'accounts'
  changesCount: number
  onSelectFiles: () => void
  onSelectChanges: () => void
  onSelectAccounts: () => void
}

export function SidebarActivityBar({
  isOpen,
  view,
  changesCount,
  onSelectFiles,
  onSelectChanges,
  onSelectAccounts
}: SidebarActivityBarProps): React.JSX.Element {
  const filesActive = isOpen && view === 'files'
  const changesActive = isOpen && view === 'changes'
  const accountsActive = isOpen && view === 'accounts'
  const badge = changesCount > 99 ? '99+' : String(changesCount)

  return (
    <aside className="activity-rail flex w-11 shrink-0 flex-col items-center gap-1.5 py-2.5">
      <button
        type="button"
        onClick={onSelectFiles}
        title={filesActive ? 'Hide files' : 'Show files'}
        aria-label={filesActive ? 'Hide files' : 'Show files'}
        className={cn(
          'glass-icon-btn h-9 w-9',
          filesActive && 'glass-icon-btn-active'
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
          'glass-icon-btn h-9 w-9',
          accountsActive && 'glass-icon-btn-active'
        )}
      >
        <UsersRound className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onSelectChanges}
        title={changesActive ? 'Hide changes' : 'Show changes'}
        aria-label={changesActive ? 'Hide changes' : 'Show changes'}
        className={cn(
          'glass-icon-btn relative h-9 w-9',
          changesActive && 'glass-icon-btn-active'
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
