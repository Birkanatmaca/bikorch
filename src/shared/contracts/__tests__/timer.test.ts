import { describe, expect, it } from 'vitest'
import {
  clampTimerSettings,
  creditTime,
  createEmptyDayStats,
  displayMs,
  elapsedMs,
  formatTimerClock,
  liveDayStats,
  localDateKey,
  nextPomodoroPhase,
  nextWidgetStyle,
  parseTimerSnapshot,
  remainingMs,
  splitMsByDay,
  startOfLocalDay
} from '../timer'

describe('timer clock', () => {
  it('formats under and over an hour', () => {
    expect(formatTimerClock(0)).toBe('00:00')
    expect(formatTimerClock(1_500)).toBe('00:01')
    expect(formatTimerClock(25 * 60_000)).toBe('25:00')
    expect(formatTimerClock(3_661_000)).toBe('1:01:01')
  })

  it('counts elapsed and remaining from wall-clock starts', () => {
    const session = {
      mode: 'pomodoro' as const,
      status: 'running' as const,
      phase: 'focus' as const,
      startedAt: 1_000,
      accumulatedMs: 5_000,
      durationMs: 25_000,
      pomodorosInCycle: 0
    }
    expect(elapsedMs(session, 11_000)).toBe(15_000)
    expect(remainingMs(session, 11_000)).toBe(10_000)
    expect(displayMs(session, 11_000)).toBe(10_000)
  })
})

describe('pomodoro phase', () => {
  it('takes a long break after every N focus blocks', () => {
    expect(nextPomodoroPhase('focus', 3, 4)).toEqual({ phase: 'longBreak', pomodorosInCycle: 4 })
    expect(nextPomodoroPhase('focus', 0, 4)).toEqual({ phase: 'shortBreak', pomodorosInCycle: 1 })
    expect(nextPomodoroPhase('shortBreak', 2, 4)).toEqual({ phase: 'focus', pomodorosInCycle: 2 })
  })

  it('cycles widget skins', () => {
    expect(nextWidgetStyle('digital')).toBe('ring')
    expect(nextWidgetStyle('ring')).toBe('minimal')
    expect(nextWidgetStyle('minimal')).toBe('digital')
  })
})

describe('daily stats', () => {
  it('splits a session that crosses midnight', () => {
    const midnight = startOfLocalDay(Date.now()) + 86_400_000
    const slices = splitMsByDay(midnight - 4_000, midnight + 6_000)
    expect(slices).toHaveLength(2)
    expect(slices[0].ms).toBe(4_000)
    expect(slices[1].ms).toBe(6_000)
    expect(slices[0].date).not.toBe(slices[1].date)
  })

  it('credits focus to the day and tracks the longest stretch', () => {
    const start = startOfLocalDay(Date.now()) + 3_600_000
    const days = creditTime({}, 'focus', start, start + 12 * 60_000)
    const date = localDateKey(start)
    expect(days[date]?.focusMs).toBe(12 * 60_000)
    expect(days[date]?.longestFocusMs).toBe(12 * 60_000)
  })

  it('includes the live running session in today without mutating stored days', () => {
    const now = Date.now()
    const date = localDateKey(now)
    const days = { [date]: { ...createEmptyDayStats(date), focusMs: 60_000 } }
    const live = liveDayStats(
      days,
      {
        mode: 'stopwatch',
        status: 'running',
        phase: 'focus',
        startedAt: now - 30_000,
        accumulatedMs: 0,
        durationMs: 0,
        pomodorosInCycle: 0
      },
      now
    )
    expect(live.focusMs).toBe(90_000)
    expect(days[date]?.focusMs).toBe(60_000)
  })
})

describe('timer snapshot', () => {
  it('clamps settings and restores a running session', () => {
    const settings = clampTimerSettings({
      focusMinutes: 400,
      shortBreakMinutes: 0,
      widgetStyle: 'ring',
      autoStartNext: true
    })
    expect(settings.focusMinutes).toBe(180)
    expect(settings.shortBreakMinutes).toBe(1)
    expect(settings.widgetStyle).toBe('ring')
    expect(settings.autoStartNext).toBe(true)

    const parsed = parseTimerSnapshot({
      settings,
      session: {
        mode: 'pomodoro',
        status: 'running',
        phase: 'shortBreak',
        startedAt: 42,
        accumulatedMs: 1000,
        durationMs: 300_000,
        pomodorosInCycle: 2
      },
      days: { 'not-a-date': { focusMs: 9 } }
    })
    expect(parsed.session.status).toBe('running')
    expect(parsed.session.startedAt).toBe(42)
    expect(parsed.session.phase).toBe('shortBreak')
    expect(parsed.days).toEqual({})
  })
})
