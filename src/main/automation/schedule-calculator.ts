import { CronExpressionParser } from 'cron-parser'
import type { AutomationSchedule } from '@shared/contracts/automation'

/**
 * Wraps the vetted `cron-parser` dependency so the rest of the automation
 * system depends on this narrow interface instead of a specific recurrence
 * library. Swapping the implementation later must not change callers.
 */
export interface ScheduleCalculator {
  /** Strictly-future occurrence after `now`, or null if the schedule cannot recur. */
  nextOccurrenceAfter(schedule: AutomationSchedule, now: number): number | null
  /** Latest occurrence at or before `now`, or null if none has happened yet. */
  latestOccurrenceAtOrBefore(schedule: AutomationSchedule, now: number): number | null
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function localTimeParts(localTime: string): { minute: number; hour: number } {
  const [hourText, minuteText] = localTime.split(':')
  return { hour: Number(hourText), minute: Number(minuteText) }
}

function toCronSpec(schedule: AutomationSchedule): { expression: string; timeZone: string } | null {
  switch (schedule.kind) {
    case 'daily': {
      const { hour, minute } = localTimeParts(schedule.localTime)
      return { expression: `${minute} ${hour} * * *`, timeZone: schedule.timeZone }
    }
    case 'weekdays': {
      const { hour, minute } = localTimeParts(schedule.localTime)
      return { expression: `${minute} ${hour} * * 1-5`, timeZone: schedule.timeZone }
    }
    case 'weekly': {
      const { hour, minute } = localTimeParts(schedule.localTime)
      const days = [...schedule.days].sort().join(',')
      return { expression: `${minute} ${hour} * * ${days}`, timeZone: schedule.timeZone }
    }
    case 'cron':
      return { expression: schedule.expression, timeZone: schedule.timeZone }
    default:
      return null
  }
}

function intervalStepMs(everyMinutes: number): number {
  return Math.max(1, Math.floor(everyMinutes)) * 60_000
}

class CronParserScheduleCalculator implements ScheduleCalculator {
  nextOccurrenceAfter(schedule: AutomationSchedule, now: number): number | null {
    if (schedule.kind === 'once') {
      return schedule.runAt > now ? schedule.runAt : null
    }

    if (schedule.kind === 'interval') {
      const stepMs = intervalStepMs(schedule.everyMinutes)
      if (now < schedule.anchorAt) return schedule.anchorAt
      const steps = Math.floor((now - schedule.anchorAt) / stepMs) + 1
      return schedule.anchorAt + steps * stepMs
    }

    let spec: { expression: string; timeZone: string } | null = null
    try {
      spec = toCronSpec(schedule)
    } catch {
      return null
    }
    if (!spec) return null
    try {
      const interval = CronExpressionParser.parse(spec.expression, {
        currentDate: new Date(now),
        tz: spec.timeZone
      })
      return interval.next().getTime()
    } catch {
      return null
    }
  }

  latestOccurrenceAtOrBefore(schedule: AutomationSchedule, now: number): number | null {
    if (schedule.kind === 'once') {
      return schedule.runAt <= now ? schedule.runAt : null
    }

    if (schedule.kind === 'interval') {
      const stepMs = intervalStepMs(schedule.everyMinutes)
      if (now < schedule.anchorAt) return null
      const steps = Math.floor((now - schedule.anchorAt) / stepMs)
      return schedule.anchorAt + steps * stepMs
    }

    let spec: { expression: string; timeZone: string } | null = null
    try {
      spec = toCronSpec(schedule)
    } catch {
      return null
    }
    if (!spec) return null
    try {
      // `.prev()` is exclusive of `currentDate`. Add 1ms so an occurrence that
      // lands exactly on `now` is still returned as "at or before now".
      const interval = CronExpressionParser.parse(spec.expression, {
        currentDate: new Date(now + 1),
        tz: spec.timeZone
      })
      return interval.prev().getTime()
    } catch {
      return null
    }
  }
}

export function createScheduleCalculator(): ScheduleCalculator {
  return new CronParserScheduleCalculator()
}

export function localTimeToCronSpec(
  schedule: AutomationSchedule
): { expression: string; timeZone: string } | null {
  return toCronSpec(schedule)
}

export function formatLocalTime(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`
}
