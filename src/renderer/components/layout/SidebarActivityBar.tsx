import { BarChart3, CheckSquare2, Files, GitBranch, Music2, UsersRound } from 'lucide-react'
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, type ProjectTask } from '@shared/contracts/tasks'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { cn } from '@renderer/lib/utils'
import { useTasksStore } from '@renderer/stores/tasks-store'

const NO_TASKS: ProjectTask[] = []

function formatNodeCount(count: number): string {
  return count > 9 ? '9+' : String(count)
}

interface SidebarActivityBarProps {
  isOpen: boolean
  view: 'files' | 'changes' | 'accounts' | 'tasks' | 'profile' | 'music'
  changesCount: number
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
  const badge = changesCount > 99 ? '99+' : String(changesCount)
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
        className={cn(
          'glass-icon-btn relative h-9 w-9',
          tasksActive && 'glass-icon-btn-active'
        )}
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
        onClick={onSelectMusic}
        aria-pressed={musicActive}
        title={musicActive ? 'Hide music' : 'Show music'}
        aria-label={musicActive ? 'Hide music' : 'Show music'}
        className={cn(
          'glass-icon-btn h-9 w-9',
          musicActive && 'glass-icon-btn-active'
        )}
      >
        <Music2 className="h-4 w-4" />
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
