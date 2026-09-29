import { Brain, CircleUser, FolderTree, GitBranch, SquareTerminal } from 'lucide-react'
import type { LeftSidebarView } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { SidebarToolsGroup } from './SidebarToolsGroup'

interface SidebarActivityBarProps {
  isOpen: boolean
  view: LeftSidebarView
  changesCount: number
  overlapCount?: number
  conflict?: boolean
  onSelectFiles: () => void
  onSelectChanges: () => void
  onSelectAccounts: () => void
  onSelectMemory: () => void
  onSelectTasks: () => void
  onSelectProfile: () => void
  onSelectMusic: () => void
  onSelectTimer: () => void
  onSelectSettings: () => void
}

export function SidebarActivityBar({
  isOpen,
  view,
  changesCount,
  overlapCount = 0,
  conflict = false,
  onSelectFiles,
  onSelectChanges,
  onSelectAccounts,
  onSelectMemory,
  onSelectTasks,
  onSelectProfile,
  onSelectMusic,
  onSelectTimer,
  onSelectSettings
}: SidebarActivityBarProps): React.JSX.Element {
  const filesActive = isOpen && view === 'files'
  const changesActive = isOpen && view === 'changes'
  const accountsActive = isOpen && view === 'accounts'
  const memoryActive = isOpen && view === 'memory'
  const profileActive = isOpen && view === 'profile'
  const badge = changesCount > 99 ? '99+' : String(changesCount)
  const overlapBadge = overlapCount > 9 ? '9+' : String(overlapCount)
  const gitAlert = conflict || overlapCount > 0

  return (
    <aside className="activity-rail workstation-rail flex w-12 shrink-0 flex-col items-center gap-2 py-2.5" aria-label="Workspace navigation">
      <div className="activity-rail-group" aria-label="Workspace">
        <button
          type="button"
          onClick={onSelectFiles}
          aria-pressed={filesActive}
          title={filesActive ? 'Hide files' : 'Show files'}
          aria-label={filesActive ? 'Hide files' : 'Show files'}
          className={cn('glass-icon-btn h-9 w-9', filesActive && 'glass-icon-btn-active')}
        >
          <FolderTree className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onSelectChanges}
          aria-pressed={changesActive}
          title={conflict ? 'Needs attention' : overlapCount > 0 ? 'Review recommended' : changesActive ? 'Hide Agent Work & Changes' : 'Show Agent Work & Changes'}
          aria-label={conflict ? 'Show Agent Work & Changes, needs attention' : overlapCount > 0 ? 'Show Agent Work & Changes, review recommended' : changesActive ? 'Hide Agent Work & Changes' : 'Show Agent Work & Changes'}
          className={cn('glass-icon-btn relative h-9 w-9', changesActive && 'glass-icon-btn-active')}
        >
          <GitBranch className="h-4 w-4" />
          {gitAlert ? (
            <span className={cn('activity-badge', conflict ? 'is-conflict' : 'is-overlap')}>
              {conflict && overlapCount === 0 ? '!' : overlapBadge}
            </span>
          ) : changesCount > 0 ? <span className="activity-badge">{badge}</span> : null}
        </button>
        <button
          type="button"
          onClick={onSelectAccounts}
          aria-pressed={accountsActive}
          title={accountsActive ? 'Hide CLI accounts' : 'Show CLI accounts'}
          aria-label={accountsActive ? 'Hide CLI accounts' : 'Show CLI accounts'}
          className={cn('glass-icon-btn h-9 w-9', accountsActive && 'glass-icon-btn-active')}
        >
          <SquareTerminal className="h-4 w-4" />
        </button>
      </div>
      <span className="activity-rail-divider" aria-hidden="true" />
      <div className="activity-rail-group" aria-label="Intelligence">
        <button
          type="button"
          onClick={onSelectMemory}
          aria-pressed={memoryActive}
          title={memoryActive ? 'Hide Intelligence' : 'Show Intelligence'}
          aria-label={memoryActive ? 'Hide Intelligence' : 'Show Intelligence'}
          className={cn('glass-icon-btn h-9 w-9', memoryActive && 'glass-icon-btn-active')}
        >
          <Brain className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onSelectProfile}
          aria-pressed={profileActive}
          title={profileActive ? 'Hide developer profile' : 'Show developer profile'}
          aria-label={profileActive ? 'Hide developer profile' : 'Show developer profile'}
          className={cn('glass-icon-btn h-9 w-9', profileActive && 'glass-icon-btn-active')}
        >
          <CircleUser className="h-4 w-4" />
        </button>
      </div>
      <SidebarToolsGroup
        isOpen={isOpen}
        view={view}
        onSelectTasks={onSelectTasks}
        onSelectMusic={onSelectMusic}
        onSelectTimer={onSelectTimer}
        onSelectSettings={onSelectSettings}
      />
    </aside>
  )
}
