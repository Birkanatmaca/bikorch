import { BarChart3, CheckSquare2, Files, GitBranch, UsersRound } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

interface SidebarActivityBarProps {
  isOpen: boolean
  view: 'files' | 'changes' | 'accounts' | 'tasks' | 'profile'
  changesCount: number
  onSelectFiles: () => void
  onSelectChanges: () => void
  onSelectAccounts: () => void
  onSelectTasks: () => void
  onSelectProfile: () => void
}

export function SidebarActivityBar({
  isOpen,
  view,
  changesCount,
  onSelectFiles,
  onSelectChanges,
  onSelectAccounts,
  onSelectTasks,
  onSelectProfile
}: SidebarActivityBarProps): React.JSX.Element {
  const filesActive = isOpen && view === 'files'
  const changesActive = isOpen && view === 'changes'
  const accountsActive = isOpen && view === 'accounts'
  const tasksActive = isOpen && view === 'tasks'
  const profileActive = isOpen && view === 'profile'
  const badge = changesCount > 99 ? '99+' : String(changesCount)

  return (
    <aside className="activity-rail workstation-rail flex w-12 shrink-0 flex-col items-center gap-2 py-2.5" aria-label="Workspace navigation">
      <button
        type="button"
        onClick={onSelectFiles}
        aria-pressed={filesActive}
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
        onClick={onSelectProfile}
        aria-pressed={profileActive}
        title={profileActive ? 'Hide profile' : 'Show profile'}
        aria-label={profileActive ? 'Hide profile' : 'Show profile'}
        className={cn(
          'glass-icon-btn h-9 w-9',
          profileActive && 'glass-icon-btn-active'
        )}
      >
        <BarChart3 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onSelectTasks}
        aria-pressed={tasksActive}
        title={tasksActive ? 'Hide tasks' : 'Show tasks'}
        aria-label={tasksActive ? 'Hide tasks' : 'Show tasks'}
        className={cn(
          'glass-icon-btn h-9 w-9',
          tasksActive && 'glass-icon-btn-active'
        )}
      >
        <CheckSquare2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onSelectAccounts}
        aria-pressed={accountsActive}
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
        aria-pressed={changesActive}
        title={changesActive ? 'Hide changes' : 'Show changes'}
        aria-label={changesActive ? 'Hide changes' : 'Show changes'}
        className={cn(
          'glass-icon-btn relative h-9 w-9',
          changesActive && 'glass-icon-btn-active'
        )}
      >
        <GitBranch className="h-4 w-4" />
        {changesCount > 0 && (
          <span className="activity-badge">
            {badge}
          </span>
        )}
      </button>
    </aside>
  )
}
