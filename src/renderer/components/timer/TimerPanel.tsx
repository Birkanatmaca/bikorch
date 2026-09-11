import { LayoutGrid, Pause, Play, RotateCcw, SkipForward, Timer } from 'lucide-react'
import { TimerDigits } from '@renderer/components/timer/TimerDigits'
import { Button } from '@renderer/components/ui/Button'
import { cn } from '@renderer/lib/utils'
import { useTimerStore } from '@renderer/stores/timer-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import {
  displayMs,
  formatFocusHours,
  lastNDates,
  liveDayStats,
  localDateKey,
  progressRatio,
  TIMER_PHASE_LABELS,
  TIMER_WIDGET_STYLE_LABELS,
  TIMER_WIDGET_STYLES,
  type TimerMode,
  type TimerWidgetStyle
} from '@shared/contracts/timer'

function SettingStepper({
  label,
  value,
  suffix,
  onChange
}: {
  label: string
  value: number
  suffix: string
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="timer-setting">
      <span>{label}</span>
      <span className="timer-stepper">
        <button type="button" onClick={() => onChange(value - 1)} aria-label={`Decrease ${label}`}>
          −
        </button>
        <strong>
          {value}
          {suffix}
        </strong>
        <button type="button" onClick={() => onChange(value + 1)} aria-label={`Increase ${label}`}>
          +
        </button>
      </span>
    </label>
  )
}

export function TimerPanel(): React.JSX.Element {
  const session = useTimerStore((state) => state.session)
  const settings = useTimerStore((state) => state.settings)
  const days = useTimerStore((state) => state.days)
  const nowMs = useTimerStore((state) => state.nowMs)
  const setMode = useTimerStore((state) => state.setMode)
  const start = useTimerStore((state) => state.start)
  const pause = useTimerStore((state) => state.pause)
  const stop = useTimerStore((state) => state.stop)
  const skip = useTimerStore((state) => state.skip)
  const updateSettings = useTimerStore((state) => state.updateSettings)
  const openTimerPanel = useWorkspaceStore((state) => state.openTimerPanel)

  const running = session.status === 'running'
  const clock = displayMs(session, nowMs)
  const progress = progressRatio(session, nowMs)
  const today = liveDayStats(days, session, nowMs)
  const week = lastNDates(7, nowMs)
  const maxFocus = Math.max(1, ...week.map((date) => (date === today.date ? today : days[date])?.focusMs ?? 0))
  const phaseLabel = session.mode === 'pomodoro' ? TIMER_PHASE_LABELS[session.phase] : 'Work session'
  const canSkip = session.mode === 'pomodoro' && session.status !== 'idle'

  const setTimerMode = (mode: TimerMode): void => {
    setMode(mode)
  }

  return (
    <div className="timer-workbench">
      <div className="timer-modes" role="tablist" aria-label="Timer mode">
        <button
          type="button"
          role="tab"
          aria-selected={session.mode === 'stopwatch'}
          className={cn('timer-mode', session.mode === 'stopwatch' && 'is-active')}
          onClick={() => setTimerMode('stopwatch')}
        >
          Work
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={session.mode === 'pomodoro'}
          className={cn('timer-mode', session.mode === 'pomodoro' && 'is-active')}
          onClick={() => setTimerMode('pomodoro')}
        >
          Pomodoro
        </button>
      </div>

      <div className={cn('timer-stage', running && 'is-live', session.phase !== 'focus' && session.mode === 'pomodoro' && 'is-break')}>
        <p className="timer-stage-kicker">
          <Timer className="h-3 w-3" />
          {phaseLabel}
          {session.status === 'paused' ? ' · paused' : running ? ' · running' : ''}
        </p>
        <TimerDigits ms={clock} running={running} size="lg" />
        {session.mode === 'pomodoro' && (
          <div className="timer-progress" aria-hidden>
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
        )}
        <div className="timer-transport">
          <Button variant="primary" onClick={() => (running ? pause() : start())}>
            {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {running ? 'Pause' : session.status === 'paused' ? 'Resume' : 'Start'}
          </Button>
          <Button variant="ghost" onClick={() => stop()} disabled={session.status === 'idle'}>
            <RotateCcw className="h-3.5 w-3.5" />
            Stop
          </Button>
          {session.mode === 'pomodoro' && (
            <Button variant="ghost" onClick={() => skip()} disabled={!canSkip}>
              <SkipForward className="h-3.5 w-3.5" />
              Skip
            </Button>
          )}
        </div>
      </div>

      {session.mode === 'pomodoro' && (
        <section className="timer-card" aria-label="Pomodoro settings">
          <h3>Pomodoro</h3>
          <SettingStepper
            label="Focus"
            value={settings.focusMinutes}
            suffix="m"
            onChange={(value) => updateSettings({ focusMinutes: value })}
          />
          <SettingStepper
            label="Short break"
            value={settings.shortBreakMinutes}
            suffix="m"
            onChange={(value) => updateSettings({ shortBreakMinutes: value })}
          />
          <SettingStepper
            label="Long break"
            value={settings.longBreakMinutes}
            suffix="m"
            onChange={(value) => updateSettings({ longBreakMinutes: value })}
          />
          <SettingStepper
            label="Long break every"
            value={settings.longBreakEvery}
            suffix=""
            onChange={(value) => updateSettings({ longBreakEvery: value })}
          />
          <label className="timer-toggle">
            <input
              type="checkbox"
              checked={settings.autoStartNext}
              onChange={(event) => updateSettings({ autoStartNext: event.target.checked })}
            />
            Auto-start next phase
          </label>
        </section>
      )}

      <section className="timer-card" aria-label="Today">
        <h3>Today</h3>
        <div className="timer-stats">
          <div>
            <strong>{formatFocusHours(today.focusMs)}</strong>
            <span>Focus</span>
          </div>
          <div>
            <strong>{today.pomodoros}</strong>
            <span>Pomodoros</span>
          </div>
          <div>
            <strong>{today.sessions}</strong>
            <span>Sessions</span>
          </div>
          <div>
            <strong>{formatFocusHours(today.longestFocusMs)}</strong>
            <span>Longest</span>
          </div>
        </div>
        <div className="timer-week" aria-label="Last 7 days">
          {week.map((date) => {
            const stats = date === today.date ? today : days[date]
            const focusMs = stats?.focusMs ?? 0
            const height = Math.max(6, Math.round((focusMs / maxFocus) * 36))
            const isToday = date === localDateKey(nowMs)
            return (
              <div key={date} className={cn('timer-week-col', isToday && 'is-today')} title={`${date} · ${formatFocusHours(focusMs)}`}>
                <span style={{ height }} />
                <em>{date.slice(8)}</em>
              </div>
            )
          })}
        </div>
      </section>

      <section className="timer-card" aria-label="Workspace widget">
        <h3>Workspace widget</h3>
        <div className="timer-skins">
          {TIMER_WIDGET_STYLES.map((style: TimerWidgetStyle) => (
            <button
              key={style}
              type="button"
              className={cn('timer-skin', settings.widgetStyle === style && 'is-active')}
              onClick={() => updateSettings({ widgetStyle: style })}
            >
              {TIMER_WIDGET_STYLE_LABELS[style]}
            </button>
          ))}
        </div>
        <Button variant="secondary" className="w-full justify-center" onClick={() => openTimerPanel()}>
          <LayoutGrid className="h-3.5 w-3.5" />
          Add to workspace
        </Button>
      </section>
    </div>
  )
}
