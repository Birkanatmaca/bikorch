export type TimerMode = 'stopwatch' | 'pomodoro'
export type TimerStatus = 'idle' | 'running' | 'paused'
export type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak'
export type TimerWidgetStyle = 'digital' | 'ring' | 'minimal'

export const TIMER_WIDGET_STYLES: readonly TimerWidgetStyle[] = ['digital', 'ring', 'minimal'] as const

export const TIMER_PHASE_LABELS: Record<PomodoroPhase, string> = {
  focus: 'Focus',
  shortBreak: 'Short break',
  longBreak: 'Long break'
}

export const TIMER_WIDGET_STYLE_LABELS: Record<TimerWidgetStyle, string> = {
  digital: 'Digital',
  ring: 'Ring',
  minimal: 'Minimal'
}

export interface TimerSettings {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  longBreakEvery: number
  autoStartNext: boolean
  widgetStyle: TimerWidgetStyle
}

export interface TimerSession {
  mode: TimerMode
  status: TimerStatus
  phase: PomodoroPhase
  startedAt: number | null
  accumulatedMs: number
  durationMs: number
  pomodorosInCycle: number
}

export interface TimerDayStats {
  date: string
  focusMs: number
  breakMs: number
  sessions: number
  pomodoros: number
  longestFocusMs: number
}

export interface TimerSnapshot {
  settings: TimerSettings
  session: TimerSession
  days: Record<string, TimerDayStats>
}

export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  autoStartNext: false,
  widgetStyle: 'digital'
}

export function createIdleSession(mode: TimerMode = 'stopwatch'): TimerSession {
  return {
    mode,
    status: 'idle',
    phase: 'focus',
    startedAt: null,
    accumulatedMs: 0,
    durationMs: 0,
    pomodorosInCycle: 0
  }
}

export function createEmptyDayStats(date: string): TimerDayStats {
  return {
    date,
    focusMs: 0,
    breakMs: 0,
    sessions: 0,
    pomodoros: 0,
    longestFocusMs: 0
  }
}

export function createDefaultTimerSnapshot(): TimerSnapshot {
  return {
    settings: { ...DEFAULT_TIMER_SETTINGS },
    session: createIdleSession(),
    days: {}
  }
}

export function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampTimerSettings(input: Partial<TimerSettings> | null | undefined): TimerSettings {
  const source = input ?? {}
  const widgetStyle = TIMER_WIDGET_STYLES.includes(source.widgetStyle as TimerWidgetStyle)
    ? (source.widgetStyle as TimerWidgetStyle)
    : DEFAULT_TIMER_SETTINGS.widgetStyle
  return {
    focusMinutes: clampInt(source.focusMinutes ?? DEFAULT_TIMER_SETTINGS.focusMinutes, 1, 180, 25),
    shortBreakMinutes: clampInt(
      source.shortBreakMinutes ?? DEFAULT_TIMER_SETTINGS.shortBreakMinutes,
      1,
      60,
      5
    ),
    longBreakMinutes: clampInt(
      source.longBreakMinutes ?? DEFAULT_TIMER_SETTINGS.longBreakMinutes,
      1,
      60,
      15
    ),
    longBreakEvery: clampInt(source.longBreakEvery ?? DEFAULT_TIMER_SETTINGS.longBreakEvery, 2, 12, 4),
    autoStartNext: source.autoStartNext === true,
    widgetStyle
  }
}

export function nextWidgetStyle(style: TimerWidgetStyle): TimerWidgetStyle {
  const index = TIMER_WIDGET_STYLES.indexOf(style)
  return TIMER_WIDGET_STYLES[(index + 1) % TIMER_WIDGET_STYLES.length] ?? 'digital'
}

export function localDateKey(ms = Date.now()): string {
  const date = new Date(ms)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function formatTimerClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatFocusHours(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000))
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

export function phaseDurationMs(settings: TimerSettings, phase: PomodoroPhase): number {
  if (phase === 'shortBreak') return settings.shortBreakMinutes * 60_000
  if (phase === 'longBreak') return settings.longBreakMinutes * 60_000
  return settings.focusMinutes * 60_000
}

export function elapsedMs(session: TimerSession, now = Date.now()): number {
  const running = session.status === 'running' && session.startedAt != null
    ? Math.max(0, now - session.startedAt)
    : 0
  return Math.max(0, session.accumulatedMs + running)
}

export function remainingMs(session: TimerSession, now = Date.now()): number {
  if (session.durationMs <= 0) return 0
  return Math.max(0, session.durationMs - elapsedMs(session, now))
}

export function displayMs(session: TimerSession, now = Date.now()): number {
  return session.mode === 'pomodoro' ? remainingMs(session, now) : elapsedMs(session, now)
}

export function progressRatio(session: TimerSession, now = Date.now()): number {
  if (session.mode !== 'pomodoro' || session.durationMs <= 0) return 0
  return Math.min(1, elapsedMs(session, now) / session.durationMs)
}

export function isFocusPhase(session: TimerSession): boolean {
  return session.mode === 'stopwatch' || session.phase === 'focus'
}

export function nextPomodoroPhase(
  phase: PomodoroPhase,
  pomodorosInCycle: number,
  longBreakEvery: number
): { phase: PomodoroPhase; pomodorosInCycle: number } {
  if (phase !== 'focus') {
    return { phase: 'focus', pomodorosInCycle }
  }
  const nextCount = pomodorosInCycle + 1
  const every = Math.max(1, longBreakEvery)
  return {
    phase: nextCount % every === 0 ? 'longBreak' : 'shortBreak',
    pomodorosInCycle: nextCount
  }
}

export function splitMsByDay(startMs: number, endMs: number): Array<{ date: string; ms: number }> {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return []
  const slices: Array<{ date: string; ms: number }> = []
  let cursor = startMs
  while (cursor < endMs) {
    const nextMidnight = startOfLocalDay(cursor) + 86_400_000
    const sliceEnd = Math.min(endMs, nextMidnight)
    slices.push({ date: localDateKey(cursor), ms: sliceEnd - cursor })
    cursor = sliceEnd
  }
  return slices
}

export function creditTime(
  days: Record<string, TimerDayStats>,
  kind: 'focus' | 'break',
  startMs: number,
  endMs: number
): Record<string, TimerDayStats> {
  const slices = splitMsByDay(startMs, endMs)
  if (slices.length === 0) return days
  const next = { ...days }
  for (const slice of slices) {
    const day = next[slice.date] ?? createEmptyDayStats(slice.date)
    next[slice.date] =
      kind === 'focus'
        ? { ...day, focusMs: day.focusMs + slice.ms }
        : { ...day, breakMs: day.breakMs + slice.ms }
  }
  if (kind === 'focus') {
    const startDate = slices[0].date
    const day = next[startDate] ?? createEmptyDayStats(startDate)
    next[startDate] = {
      ...day,
      longestFocusMs: Math.max(day.longestFocusMs, endMs - startMs)
    }
  }
  return next
}

export function bumpDayCounter(
  days: Record<string, TimerDayStats>,
  date: string,
  field: 'sessions' | 'pomodoros',
  amount = 1
): Record<string, TimerDayStats> {
  const day = days[date] ?? createEmptyDayStats(date)
  return {
    ...days,
    [date]: {
      ...day,
      [field]: day[field] + amount
    }
  }
}

export function pruneTimerDays(
  days: Record<string, TimerDayStats>,
  keep = 90,
  now = Date.now()
): Record<string, TimerDayStats> {
  const cutoff = startOfLocalDay(now) - keep * 86_400_000
  const next: Record<string, TimerDayStats> = {}
  for (const [date, stats] of Object.entries(days)) {
    const parsed = Date.parse(`${date}T00:00:00`)
    if (!Number.isFinite(parsed) || parsed < cutoff) continue
    next[date] = stats
  }
  return next
}

export function lastNDates(count: number, now = Date.now()): string[] {
  const dates: string[] = []
  const start = startOfLocalDay(now)
  for (let i = count - 1; i >= 0; i -= 1) {
    dates.push(localDateKey(start - i * 86_400_000))
  }
  return dates
}

export function dayStatsFor(days: Record<string, TimerDayStats>, date: string): TimerDayStats {
  return days[date] ?? createEmptyDayStats(date)
}

export function liveDayStats(
  days: Record<string, TimerDayStats>,
  session: TimerSession,
  now = Date.now()
): TimerDayStats {
  const date = localDateKey(now)
  const base = dayStatsFor(days, date)
  if (session.status === 'idle') return base
  const elapsed = elapsedMs(session, now)
  if (elapsed <= 0) return base
  if (isFocusPhase(session)) {
    return {
      ...base,
      focusMs: base.focusMs + elapsed,
      longestFocusMs: Math.max(base.longestFocusMs, elapsed)
    }
  }
  return {
    ...base,
    breakMs: base.breakMs + elapsed
  }
}

export function parseTimerMode(value: unknown): TimerMode {
  return value === 'pomodoro' ? 'pomodoro' : 'stopwatch'
}

export function parseTimerStatus(value: unknown): TimerStatus {
  return value === 'running' || value === 'paused' ? value : 'idle'
}

export function parsePomodoroPhase(value: unknown): PomodoroPhase {
  return value === 'shortBreak' || value === 'longBreak' ? value : 'focus'
}

export function parseTimerSnapshot(raw: unknown): TimerSnapshot {
  const fallback = createDefaultTimerSnapshot()
  if (!raw || typeof raw !== 'object') return fallback
  const input = raw as Partial<TimerSnapshot> & { session?: Partial<TimerSession> }
  const settings = clampTimerSettings(input.settings)
  const sessionInput: Partial<TimerSession> = input.session ?? {}
  const status = parseTimerStatus(sessionInput.status)
  const session: TimerSession = {
    mode: parseTimerMode(sessionInput.mode),
    status,
    phase: parsePomodoroPhase(sessionInput.phase),
    startedAt:
      status === 'running' && typeof sessionInput.startedAt === 'number' && sessionInput.startedAt > 0
        ? sessionInput.startedAt
        : null,
    accumulatedMs:
      typeof sessionInput.accumulatedMs === 'number' && sessionInput.accumulatedMs >= 0
        ? sessionInput.accumulatedMs
        : 0,
    durationMs:
      typeof sessionInput.durationMs === 'number' && sessionInput.durationMs >= 0
        ? sessionInput.durationMs
        : 0,
    pomodorosInCycle: clampInt(sessionInput.pomodorosInCycle ?? 0, 0, 99, 0)
  }
  const days: Record<string, TimerDayStats> = {}
  if (input.days && typeof input.days === 'object') {
    for (const [date, stats] of Object.entries(input.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !stats || typeof stats !== 'object') continue
      days[date] = {
        date,
        focusMs: Math.max(0, Number(stats.focusMs) || 0),
        breakMs: Math.max(0, Number(stats.breakMs) || 0),
        sessions: Math.max(0, Number(stats.sessions) || 0),
        pomodoros: Math.max(0, Number(stats.pomodoros) || 0),
        longestFocusMs: Math.max(0, Number(stats.longestFocusMs) || 0)
      }
    }
  }
  return { settings, session, days: pruneTimerDays(days) }
}
