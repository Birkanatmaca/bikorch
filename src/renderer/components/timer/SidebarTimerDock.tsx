import { Pause, Play } from 'lucide-react'
import { TimerDigits } from '@renderer/components/timer/TimerDigits'
import { cn } from '@renderer/lib/utils'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { useTimerStore } from '@renderer/stores/timer-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import {
  displayMs,
  TIMER_PHASE_LABELS
} from '@shared/contracts/timer'

export function SidebarTimerDock(): React.JSX.Element | null {
  const session = useTimerStore((state) => state.session)
  const nowMs = useTimerStore((state) => state.nowMs)
  const toggle = useTimerStore((state) => state.toggle)
  const selectLeftSidebar = useWorkspaceStore((state) => state.selectLeftSidebar)
  const { projectId } = useActiveProject()

  if (session.status === 'idle') return null

  const running = session.status === 'running'
  const label = session.mode === 'pomodoro' ? TIMER_PHASE_LABELS[session.phase] : 'Work'

  return (
    <div className={cn('timer-dock', running && 'is-live')}>
      <button
        type="button"
        className="timer-dock-main"
        onClick={() => {
          if (projectId) selectLeftSidebar(projectId, 'timer')
        }}
      >
        <span className={cn('timer-dock-led', running && 'is-on')} aria-hidden />
        <span className="timer-dock-copy">
          <span className="timer-dock-label">{label}</span>
          <TimerDigits ms={displayMs(session, nowMs)} running={running} size="sm" />
        </span>
      </button>
      <button
        type="button"
        className="timer-dock-toggle"
        onClick={() => toggle()}
        aria-label={running ? 'Pause timer' : 'Resume timer'}
      >
        {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
