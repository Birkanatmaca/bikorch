import { create } from 'zustand'
import {
  bumpDayCounter,
  clampTimerSettings,
  createIdleSession,
  creditTime,
  elapsedMs,
  isFocusPhase,
  localDateKey,
  nextPomodoroPhase,
  nextWidgetStyle,
  parseTimerSnapshot,
  phaseDurationMs,
  pruneTimerDays,
  remainingMs,
  type PomodoroPhase,
  type TimerDayStats,
  type TimerMode,
  type TimerSession,
  type TimerSettings,
  type TimerSnapshot,
  type TimerStatus,
  type TimerWidgetStyle
} from '@shared/contracts/timer'

const STORAGE_KEY = 'bikorch.timer'
const SAVE_DEBOUNCE_MS = 280

let saveTimer: ReturnType<typeof setTimeout> | null = null
let notifiedForStartedAt: number | null = null

function readStoredSnapshot(): TimerSnapshot {
  if (typeof window === 'undefined') return parseTimerSnapshot(null)
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return parseTimerSnapshot(raw ? JSON.parse(raw) : null)
  } catch {
    return parseTimerSnapshot(null)
  }
}

function persistSnapshot(snapshot: TimerSnapshot): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settings: snapshot.settings,
        session: snapshot.session,
        days: pruneTimerDays(snapshot.days)
      })
    )
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function schedulePersist(snapshot: TimerSnapshot): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistSnapshot(snapshot)
  }, SAVE_DEBOUNCE_MS)
}

function creditOpenSegment(
  days: Record<string, TimerDayStats>,
  session: TimerSession,
  now: number
): Record<string, TimerDayStats> {
  const elapsed = elapsedMs(session, now)
  if (elapsed <= 0) return days
  const end = now
  const start = end - elapsed
  return creditTime(days, isFocusPhase(session) ? 'focus' : 'break', start, end)
}

function phaseLabel(phase: PomodoroPhase): string {
  if (phase === 'shortBreak') return 'Short break'
  if (phase === 'longBreak') return 'Long break'
  return 'Focus'
}

function notifyPhaseComplete(ended: PomodoroPhase, next: PomodoroPhase): void {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  const title = ended === 'focus' ? 'Focus complete' : 'Break complete'
  try {
    new Notification(title, {
      body: `${phaseLabel(next)} is next.`,
      silent: false
    })
  } catch {
    // Notifications can fail in unsigned Electron builds.
  }
}

function requestNotificationPermission(): void {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return
  if (Notification.permission !== 'default') return
  void Notification.requestPermission().catch(() => undefined)
}

function playPhaseChime(): void {
  if (typeof window === 'undefined') return
  const AudioCtx =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return
  try {
    const ctx = new AudioCtx()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gain.gain.value = 0.04
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start()
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    oscillator.stop(ctx.currentTime + 0.36)
    oscillator.onended = () => {
      void ctx.close()
    }
  } catch {
    // Audio is optional.
  }
}

interface TimerStore extends TimerSnapshot {
  nowMs: number
  hydrate: () => void
  persistNow: () => void
  tick: (now?: number) => void
  setMode: (mode: TimerMode) => void
  start: () => void
  pause: () => void
  resume: () => void
  toggle: () => void
  stop: () => void
  skip: () => void
  updateSettings: (patch: Partial<TimerSettings>) => void
  cycleWidgetStyle: () => void
  setWidgetStyle: (style: TimerWidgetStyle) => void
}

function beginPhase(
  session: TimerSession,
  settings: TimerSettings,
  phase: PomodoroPhase,
  now: number,
  autoStart: boolean
): TimerSession {
  return {
    ...session,
    mode: 'pomodoro',
    phase,
    status: autoStart ? 'running' : 'idle',
    startedAt: autoStart ? now : null,
    accumulatedMs: 0,
    durationMs: phaseDurationMs(settings, phase)
  }
}

const initial = readStoredSnapshot()

export const useTimerStore = create<TimerStore>((set, get) => ({
  ...initial,
  nowMs: Date.now(),

  hydrate: () => {
    const snapshot = readStoredSnapshot()
    set({ ...snapshot, nowMs: Date.now() })
  },

  persistNow: () => {
    const { settings, session, days } = get()
    persistSnapshot({ settings, session, days })
  },

  tick: (now = Date.now()) => {
    const { session, settings, days } = get()
    set({ nowMs: now })
    if (session.status !== 'running') return
    if (session.mode !== 'pomodoro') return
    if (remainingMs(session, now) > 0) return
    if (session.startedAt != null && notifiedForStartedAt === session.startedAt) return

    const endedPhase = session.phase
    const credited = creditOpenSegment(days, session, now)
    const date = localDateKey(now)
    let nextDays = credited
    if (endedPhase === 'focus') {
      nextDays = bumpDayCounter(nextDays, date, 'pomodoros')
    }
    const next = nextPomodoroPhase(endedPhase, session.pomodorosInCycle, settings.longBreakEvery)
    notifiedForStartedAt = session.startedAt
    notifyPhaseComplete(endedPhase, next.phase)
    playPhaseChime()
    const nextSession = beginPhase(
      { ...session, pomodorosInCycle: next.pomodorosInCycle },
      settings,
      next.phase,
      now,
      settings.autoStartNext
    )
    const snapshot = { settings, session: nextSession, days: nextDays }
    set({ ...snapshot, nowMs: now })
    persistSnapshot(snapshot)
  },

  setMode: (mode) => {
    const { session, settings, days } = get()
    if (session.mode === mode && session.status === 'idle') return
    const now = Date.now()
    const credited = session.status === 'idle' ? days : creditOpenSegment(days, session, now)
    const nextSession: TimerSession =
      mode === 'pomodoro'
        ? beginPhase(createIdleSession('pomodoro'), settings, 'focus', now, false)
        : createIdleSession('stopwatch')
    const snapshot = { settings, session: nextSession, days: credited }
    set({ ...snapshot, nowMs: now })
    persistSnapshot(snapshot)
  },

  start: () => {
    const { session, settings, days } = get()
    if (session.status === 'running') return
    requestNotificationPermission()
    const now = Date.now()
    const date = localDateKey(now)
    let nextDays = days
    let nextSession = session
    if (session.status === 'paused') {
      nextSession = { ...session, status: 'running', startedAt: now }
    } else if (session.mode === 'pomodoro') {
      if (session.phase === 'focus') nextDays = bumpDayCounter(days, date, 'sessions')
      nextSession = beginPhase(session, settings, session.phase || 'focus', now, true)
    } else {
      nextDays = bumpDayCounter(days, date, 'sessions')
      nextSession = {
        ...createIdleSession('stopwatch'),
        status: 'running',
        startedAt: now
      }
    }
    const snapshot = { settings, session: nextSession, days: nextDays }
    set({ ...snapshot, nowMs: now })
    persistSnapshot(snapshot)
  },

  pause: () => {
    const { session, settings, days } = get()
    if (session.status !== 'running') return
    const now = Date.now()
    const nextSession: TimerSession = {
      ...session,
      status: 'paused',
      accumulatedMs: elapsedMs(session, now),
      startedAt: null
    }
    const snapshot = { settings, session: nextSession, days }
    set({ ...snapshot, nowMs: now })
    persistSnapshot(snapshot)
  },

  resume: () => {
    get().start()
  },

  toggle: () => {
    const status: TimerStatus = get().session.status
    if (status === 'running') get().pause()
    else get().start()
  },

  stop: () => {
    const { session, settings, days } = get()
    if (session.status === 'idle' && session.accumulatedMs === 0) {
      const nextSession = createIdleSession(session.mode)
      if (session.mode === 'pomodoro') {
        nextSession.durationMs = phaseDurationMs(settings, 'focus')
        nextSession.phase = 'focus'
      }
      set({ session: nextSession, nowMs: Date.now() })
      return
    }
    const now = Date.now()
    const credited = creditOpenSegment(days, session, now)
    const nextSession =
      session.mode === 'pomodoro'
        ? beginPhase(createIdleSession('pomodoro'), settings, 'focus', now, false)
        : createIdleSession('stopwatch')
    const snapshot = { settings, session: nextSession, days: credited }
    set({ ...snapshot, nowMs: now })
    persistSnapshot(snapshot)
  },

  skip: () => {
    const { session, settings, days } = get()
    if (session.mode !== 'pomodoro') return
    const now = Date.now()
    const credited = creditOpenSegment(days, session, now)
    const next = nextPomodoroPhase(session.phase, session.pomodorosInCycle, settings.longBreakEvery)
    const nextSession = beginPhase(
      { ...session, pomodorosInCycle: next.pomodorosInCycle },
      settings,
      next.phase,
      now,
      session.status === 'running' || settings.autoStartNext
    )
    const snapshot = { settings, session: nextSession, days: credited }
    set({ ...snapshot, nowMs: now })
    persistSnapshot(snapshot)
  },

  updateSettings: (patch) => {
    const { session, days } = get()
    const settings = clampTimerSettings({ ...get().settings, ...patch })
    let nextSession = session
    if (session.mode === 'pomodoro' && session.status === 'idle') {
      nextSession = {
        ...session,
        durationMs: phaseDurationMs(settings, session.phase)
      }
    }
    const snapshot = { settings, session: nextSession, days }
    set({ ...snapshot })
    schedulePersist(snapshot)
  },

  cycleWidgetStyle: () => {
    const settings = clampTimerSettings({
      ...get().settings,
      widgetStyle: nextWidgetStyle(get().settings.widgetStyle)
    })
    const snapshot = { settings, session: get().session, days: get().days }
    set({ settings })
    schedulePersist(snapshot)
  },

  setWidgetStyle: (style) => {
    get().updateSettings({ widgetStyle: style })
  }
}))

export function selectTimerDisplay(state: TimerStore): {
  status: TimerStatus
  mode: TimerMode
  phase: PomodoroPhase
  clock: number
  running: boolean
} {
  return {
    status: state.session.status,
    mode: state.session.mode,
    phase: state.session.phase,
    clock: state.session.mode === 'pomodoro'
      ? remainingMs(state.session, state.nowMs)
      : elapsedMs(state.session, state.nowMs),
    running: state.session.status === 'running'
  }
}
