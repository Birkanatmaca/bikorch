import { GripHorizontal, Pause, Play, RotateCcw, SkipForward, Watch, X } from 'lucide-react'
import { TimerDigits } from '@renderer/components/timer/TimerDigits'
import { cn } from '@renderer/lib/utils'
import { useTimerStore } from '@renderer/stores/timer-store'
import {
  displayMs,
  progressRatio,
  TIMER_PHASE_LABELS,
  TIMER_WIDGET_STYLE_LABELS
} from '@shared/contracts/timer'

function RingProgress({ ratio }: { ratio: number }): React.JSX.Element {
  const clamped = Math.min(1, Math.max(0, ratio))
  const radius = 42
  const circumference = 2 * Math.PI * radius
  return (
    <svg className="timer-ring-svg" viewBox="0 0 100 100" aria-hidden>
      <circle className="timer-ring-track" cx="50" cy="50" r={radius} />
      <circle
        className="timer-ring-fill"
        cx="50"
        cy="50"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
      />
    </svg>
  )
}

export function WorkspaceTimerWidget({
  onMoveStart,
  onClose
}: {
  onMoveStart?: (event: React.PointerEvent) => void
  onClose?: () => void
} = {}): React.JSX.Element {
  const session = useTimerStore((state) => state.session)
  const settings = useTimerStore((state) => state.settings)
  const nowMs = useTimerStore((state) => state.nowMs)
  const toggle = useTimerStore((state) => state.toggle)
  const stop = useTimerStore((state) => state.stop)
  const skip = useTimerStore((state) => state.skip)
  const cycleWidgetStyle = useTimerStore((state) => state.cycleWidgetStyle)

  const running = session.status === 'running'
  const clock = displayMs(session, nowMs)
  const progress = session.mode === 'pomodoro' ? progressRatio(session, nowMs) : 0
  const style = settings.widgetStyle
  const phaseLabel = session.mode === 'pomodoro' ? TIMER_PHASE_LABELS[session.phase] : 'Work'
  const isBreak = session.mode === 'pomodoro' && session.phase !== 'focus'

  const beginMove = (event: React.PointerEvent): void => {
    if (!onMoveStart) return
    const target = event.target as HTMLElement
    if (target.closest('button, input')) return
    onMoveStart(event)
  }

  return (
    <div
      className={cn(
        'timer-workspace-widget',
        `is-${style}`,
        running && 'is-live',
        isBreak && 'is-break'
      )}
      onPointerDown={beginMove}
    >
      <div className="timer-widget-chassis">
        <div className="timer-widget-move">
          <GripHorizontal className="h-3 w-3 opacity-50" aria-hidden />
          <span>TIMER</span>
          <button
            type="button"
            className="timer-widget-skin"
            onClick={() => cycleWidgetStyle()}
            title={`Style: ${TIMER_WIDGET_STYLE_LABELS[style]}`}
            aria-label={`Change widget style, ${TIMER_WIDGET_STYLE_LABELS[style]}`}
          >
            <Watch className="h-3 w-3" />
          </button>
          {onClose ? (
            <button type="button" className="timer-widget-close" onClick={onClose} aria-label="Close timer">
              <X className="h-3 w-3" />
            </button>
          ) : (
            <span className="timer-widget-move-spacer" />
          )}
        </div>

        <div className="timer-widget-face">
          {style === 'ring' && <RingProgress ratio={session.mode === 'pomodoro' ? progress : running ? 1 : 0} />}
          <div className="timer-widget-readout">
            <span className={cn('timer-widget-led', running && 'is-on')} aria-hidden />
            <span className="timer-widget-phase">{phaseLabel}</span>
            <TimerDigits ms={clock} running={running} size={style === 'minimal' ? 'sm' : 'lg'} />
          </div>
        </div>

        {style === 'digital' && session.mode === 'pomodoro' && (
          <div className="timer-progress" aria-hidden>
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
        )}

        <div className="timer-widget-transport">
          <button type="button" onClick={() => toggle()} aria-label={running ? 'Pause' : 'Start'}>
            {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button type="button" onClick={() => stop()} aria-label="Stop timer">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          {session.mode === 'pomodoro' && (
            <button type="button" onClick={() => skip()} aria-label="Skip phase">
              <SkipForward className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
