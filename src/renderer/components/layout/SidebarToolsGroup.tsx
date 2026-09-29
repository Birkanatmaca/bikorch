import { useState } from 'react'
import { CheckSquare2, Music2, Settings2, Timer, Wrench } from 'lucide-react'
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, type ProjectTask } from '@shared/contracts/tasks'
import { displayMs, formatTimerClock } from '@shared/contracts/timer'
import type { LeftSidebarView } from '@shared/types'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { cn } from '@renderer/lib/utils'
import { useMusicStore } from '@renderer/stores/music-store'
import { useTasksStore } from '@renderer/stores/tasks-store'
import { useTimerStore } from '@renderer/stores/timer-store'

const NO_TASKS: ProjectTask[] = []

interface SidebarToolsGroupProps {
  isOpen: boolean
  view: LeftSidebarView
  onSelectTasks: () => void
  onSelectMusic: () => void
  onSelectTimer: () => void
  onSelectSettings: () => void
}

export function SidebarToolsGroup({
  isOpen,
  view,
  onSelectTasks,
  onSelectMusic,
  onSelectTimer,
  onSelectSettings
}: SidebarToolsGroupProps): React.JSX.Element {
  const tasksActive = isOpen && view === 'tasks'
  const musicActive = isOpen && view === 'music'
  const timerActive = isOpen && view === 'timer'
  const [expanded, setExpanded] = useState(() => ['tasks', 'music', 'timer'].includes(view))
  const musicPlaying = useMusicStore((state) => state.status === 'playing')
  const timerSession = useTimerStore((state) => state.session)
  const timerNow = useTimerStore((state) => state.nowMs)
  const timerRunning = timerSession.status === 'running'
  const timerClock = formatTimerClock(displayMs(timerSession, timerNow))
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
    <>
      <span className="activity-rail-spacer" />
      <span className="activity-rail-divider" aria-hidden="true" />
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className={cn('glass-icon-btn activity-rail-tools h-9 w-9', (expanded || tasksActive || musicActive || timerActive) && 'glass-icon-btn-active')}
        aria-label="Tools"
        title="Tools"
        aria-expanded={expanded}
      >
        <Wrench className="h-4 w-4" />
      </button>
      {expanded && (
        <div className="activity-rail-group activity-rail-tools-group" aria-label="Tools">
          <button
            type="button"
            onClick={onSelectTasks}
            aria-pressed={tasksActive}
            title={openTotal > 0 ? `${tasksActive ? 'Hide' : 'Show'} tasks · ${taskSummary}` : tasksActive ? 'Hide tasks' : 'Show tasks'}
            aria-label={openTotal > 0 ? `${tasksActive ? 'Hide' : 'Show'} tasks, ${taskSummary} open` : tasksActive ? 'Hide tasks' : 'Show tasks'}
            className={cn('glass-icon-btn relative h-9 w-9', tasksActive && 'glass-icon-btn-active')}
          >
            <CheckSquare2 className="h-4 w-4" />
            {openTotal > 0 && (
              <span className="task-rail-counts" aria-hidden>
                {TASK_PRIORITIES.map((priority) => openByPriority[priority] > 0 ? (
                  <span key={priority} className={cn('task-rail-node', `is-${priority}`)}>
                    {openByPriority[priority] > 9 ? '9+' : String(openByPriority[priority])}
                  </span>
                ) : null)}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onSelectMusic}
            aria-pressed={musicActive}
            title={musicPlaying ? 'Playing' : musicActive ? 'Hide music' : 'Show music'}
            aria-label={musicPlaying ? musicActive ? 'Hide music, now playing' : 'Show music, now playing' : musicActive ? 'Hide music' : 'Show music'}
            className={cn('glass-icon-btn relative h-9 w-9', musicActive && 'glass-icon-btn-active', musicPlaying && 'is-playing')}
          >
            <Music2 className="h-4 w-4" />
            {musicPlaying && <span className="rail-music-eq" aria-hidden><span /><span /><span /></span>}
          </button>
          <button
            type="button"
            onClick={onSelectTimer}
            aria-pressed={timerActive}
            title={timerSession.status !== 'idle' ? `${timerActive ? 'Hide' : 'Show'} timer · ${timerClock}` : timerActive ? 'Hide timer' : 'Show timer'}
            aria-label={timerSession.status !== 'idle' ? `${timerActive ? 'Hide' : 'Show'} timer, ${timerClock}${timerRunning ? ', running' : ', paused'}` : timerActive ? 'Hide timer' : 'Show timer'}
            className={cn('glass-icon-btn relative h-9 w-9', timerActive && 'glass-icon-btn-active', timerRunning && 'is-timing')}
          >
            <Timer className="h-4 w-4" />
            {timerSession.status !== 'idle' && <span className={cn('rail-timer-badge', timerRunning && 'is-live')} aria-hidden>{timerClock}</span>}
          </button>
          <button
            type="button"
            onClick={onSelectSettings}
            title="Settings and resources"
            aria-label="Settings and resources"
            className="glass-icon-btn h-9 w-9"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  )
}
