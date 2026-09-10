import { CheckSquare2, CircleUser, FolderTree, GitBranch, Music2, SquareTerminal } from 'lucide-react'
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, type ProjectTask } from '@shared/contracts/tasks'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { cn } from '@renderer/lib/utils'
import { useMusicStore } from '@renderer/stores/music-store'
import { useTasksStore } from '@renderer/stores/tasks-store'

const NO_TASKS: ProjectTask[] = []

function formatNodeCount(count: number): string {
  return count > 9 ? '9+' : String(count)
}

interface SidebarActivityBarProps {
  isOpen: boolean
  view: 'files' | 'changes' | 'accounts' | 'tasks' | 'profile' | 'music'
  changesCount: number
  overlapCount?: number
  conflict?: boolean
  onSelectFiles: () => void
  onSelectChanges: () => void
  onSelectAccounts: () => void
  onSelectTasks: () => void
  onSelectProfile: () => void
  onSelectMusic: () => void
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
  onSelectTasks,
  onSelectProfile,
  onSelectMusic
}: SidebarActivityBarProps): React.JSX.Element {
  const filesActive = isOpen && view === 'files'
  const changesActive = isOpen && view === 'changes'
  const accountsActive = isOpen && view === 'accounts'
  const tasksActive = isOpen && view === 'tasks'
  const profileActive = isOpen && view === 'profile'
  const musicActive = isOpen && view === 'music'
  const musicPlaying = useMusicStore((state) => state.status === 'playing')
  const badge = changesCount > 99 ? '99+' : String(changesCount)
  const overlapBadge = overlapCount > 9 ? '9+' : String(overlapCount)
  const gitAlert = conflict || overlapCount > 0
  const { projectId } = useActiveProject()
  const tasks = useTasksStore((state) => state.tasksByProject[projectId ?? ''] ?? NO_TASKS)
  const openByPriority = { high: 0, medium: 0, low: 0 }
  for (const task of tasks) {
    if (task.status !== 'done') openByPriority[task.priority] += 1
  }
  const openTotal = openByPriority.high + openByPriority.medium + openByPriority.low
  const taskSummary = TASK_PRIORITIES.filter((priority) => openByPriority[priority] > 0)
    .map((priority) => `${openByPriority[priority]} ${TASK_PRIORITY_LABELS[priority].toLowerCase()}`)
    .join(', ')

  return (
    <aside className="activity-rail workstation-rail flex w-12 shrink-0 flex-col items-center gap-2 py-2.5" aria-label="Workspace navigation">
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
        title={
          conflict
            ? 'Merge conflict'
            : overlapCount > 0
              ? `${overlapCount} overlapping path${overlapCount === 1 ? '' : 's'}`
              : changesActive
                ? 'Hide git'
                : 'Show git'
        }
        aria-label={
          conflict
            ? 'Show git, merge conflict'
            : overlapCount > 0
              ? `Show git, ${overlapCount} overlapping paths`
              : changesActive
                ? 'Hide git'
                : 'Show git'
        }
        className={cn('glass-icon-btn relative h-9 w-9', changesActive && 'glass-icon-btn-active')}
      >
        <GitBranch className="h-4 w-4" />
        {gitAlert ? (
          <span className={cn('activity-badge', conflict ? 'is-conflict' : 'is-overlap')}>
            {conflict && overlapCount === 0 ? '!' : overlapBadge}
          </span>
        ) : (
          changesCount > 0 && <span className="activity-badge">{badge}</span>
        )}
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
      <button
        type="button"
        onClick={onSelectMusic}
        aria-pressed={musicActive}
        title={musicPlaying ? 'Playing' : musicActive ? 'Hide music' : 'Show music'}
        aria-label={
          musicPlaying
            ? musicActive
              ? 'Hide music, now playing'
              : 'Show music, now playing'
            : musicActive
              ? 'Hide music'
              : 'Show music'
        }
        className={cn(
          'glass-icon-btn relative h-9 w-9',
          musicActive && 'glass-icon-btn-active',
          musicPlaying && 'is-playing'
        )}
      >
        <Music2 className="h-4 w-4" />
        {musicPlaying && (
          <span className="rail-music-eq" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onSelectProfile}
        aria-pressed={profileActive}
        title={profileActive ? 'Hide profile' : 'Show profile'}
        aria-label={profileActive ? 'Hide profile' : 'Show profile'}
        className={cn('glass-icon-btn h-9 w-9', profileActive && 'glass-icon-btn-active')}
      >
        <CircleUser className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onSelectTasks}
        aria-pressed={tasksActive}
        title={
          openTotal > 0
            ? `${tasksActive ? 'Hide' : 'Show'} tasks · ${taskSummary}`
            : tasksActive
              ? 'Hide tasks'
              : 'Show tasks'
        }
        aria-label={
          openTotal > 0
            ? `${tasksActive ? 'Hide' : 'Show'} tasks, ${taskSummary} open`
            : tasksActive
              ? 'Hide tasks'
              : 'Show tasks'
        }
        className={cn('glass-icon-btn relative h-9 w-9', tasksActive && 'glass-icon-btn-active')}
      >
        <CheckSquare2 className="h-4 w-4" />
        {openTotal > 0 ? (
          <span className="task-rail-counts" aria-hidden>
            {TASK_PRIORITIES.map((priority) =>
              openByPriority[priority] > 0 ? (
                <span key={priority} className={cn('task-rail-node', `is-${priority}`)}>
                  {formatNodeCount(openByPriority[priority])}
                </span>
              ) : null
            )}
          </span>
        ) : null}
      </button>
    </aside>
  )
}
