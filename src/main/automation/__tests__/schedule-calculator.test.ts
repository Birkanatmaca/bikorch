import { describe, expect, it } from 'vitest'
import { createScheduleCalculator } from '../schedule-calculator'
import type { AutomationSchedule } from '@shared/contracts/automation'

const calc = createScheduleCalculator()

describe('ScheduleCalculator — once', () => {
  it('is due only before its runAt and never recurs', () => {
    const schedule: AutomationSchedule = {
      kind: 'once',
      runAt: Date.parse('2026-09-12T09:00:00Z'),
      timeZone: 'UTC'
    }
    const before = Date.parse('2026-09-12T08:00:00Z')
    const after = Date.parse('2026-09-12T10:00:00Z')

    expect(calc.nextOccurrenceAfter(schedule, before)).toBe(schedule.runAt)
    expect(calc.nextOccurrenceAfter(schedule, after)).toBeNull()
    expect(calc.latestOccurrenceAtOrBefore(schedule, before)).toBeNull()
    expect(calc.latestOccurrenceAtOrBefore(schedule, after)).toBe(schedule.runAt)
  })
})

describe('ScheduleCalculator — daily', () => {
  const schedule: AutomationSchedule = {
    kind: 'daily',
    localTime: '09:00',
    timeZone: 'UTC'
  }

  it('finds the next occurrence strictly after now', () => {
    const now = Date.parse('2026-09-11T10:00:00Z')
    expect(calc.nextOccurrenceAfter(schedule, now)).toBe(Date.parse('2026-09-12T09:00:00Z'))
  })

  it('treats an exact match as "at or before" but not "after"', () => {
    const exact = Date.parse('2026-09-11T09:00:00Z')
    expect(calc.latestOccurrenceAtOrBefore(schedule, exact)).toBe(exact)
    expect(calc.nextOccurrenceAfter(schedule, exact)).toBe(Date.parse('2026-09-12T09:00:00Z'))
  })

  it('finds the latest occurrence at or before an arbitrary instant', () => {
    const now = Date.parse('2026-09-11T08:59:00Z')
    expect(calc.latestOccurrenceAtOrBefore(schedule, now)).toBe(Date.parse('2026-09-10T09:00:00Z'))
  })
})

describe('ScheduleCalculator — weekdays', () => {
  const schedule: AutomationSchedule = {
    kind: 'weekdays',
    localTime: '09:00',
    timeZone: 'UTC'
  }

  it('skips the weekend', () => {
    // 2026-09-11 is a Friday.
    const friday = Date.parse('2026-09-11T10:00:00Z')
    expect(calc.nextOccurrenceAfter(schedule, friday)).toBe(Date.parse('2026-09-14T09:00:00Z'))
  })
})

describe('ScheduleCalculator — weekly', () => {
  it('matches only the selected days', () => {
    const schedule: AutomationSchedule = {
      kind: 'weekly',
      days: [1, 4], // Monday, Thursday
      localTime: '08:00',
      timeZone: 'UTC'
    }
    // 2026-09-11 is a Friday; next should be the following Monday.
    const now = Date.parse('2026-09-11T10:00:00Z')
    expect(calc.nextOccurrenceAfter(schedule, now)).toBe(Date.parse('2026-09-14T08:00:00Z'))
  })
})

describe('ScheduleCalculator — interval', () => {
  const anchorAt = Date.parse('2026-09-11T00:00:00Z')
  const schedule: AutomationSchedule = { kind: 'interval', everyMinutes: 30, anchorAt }

  it('steps forward from the anchor without drifting', () => {
    const now = anchorAt + 45 * 60_000
    expect(calc.nextOccurrenceAfter(schedule, now)).toBe(anchorAt + 60 * 60_000)
    expect(calc.latestOccurrenceAtOrBefore(schedule, now)).toBe(anchorAt + 30 * 60_000)
  })

  it('returns the anchor itself when now is before it', () => {
    expect(calc.nextOccurrenceAfter(schedule, anchorAt - 1)).toBe(anchorAt)
    expect(calc.latestOccurrenceAtOrBefore(schedule, anchorAt - 1)).toBeNull()
  })
})

describe('ScheduleCalculator — cron', () => {
  it('supports raw cron expressions with a time zone', () => {
    const schedule: AutomationSchedule = {
      kind: 'cron',
      expression: '0 9 * * *',
      timeZone: 'UTC'
    }
    const now = Date.parse('2026-09-11T10:00:00Z')
    expect(calc.nextOccurrenceAfter(schedule, now)).toBe(Date.parse('2026-09-12T09:00:00Z'))
  })
})

describe('ScheduleCalculator — malformed input', () => {
  it('does not throw when a daily schedule is missing localTime', () => {
    const schedule = { kind: 'daily', timeZone: 'UTC' } as AutomationSchedule
    expect(calc.nextOccurrenceAfter(schedule, Date.now())).toBeNull()
    expect(calc.latestOccurrenceAtOrBefore(schedule, Date.now())).toBeNull()
  })
})

describe('ScheduleCalculator — DST', () => {
  it('keeps the local wall-clock time across a US DST transition', () => {
    const schedule: AutomationSchedule = {
      kind: 'daily',
      localTime: '09:00',
      timeZone: 'America/New_York'
    }
    // US DST spring-forward in 2026 is Sunday, March 8.
    const beforeChange = Date.parse('2026-03-07T20:00:00Z')
    const next = calc.nextOccurrenceAfter(schedule, beforeChange)
    expect(next).not.toBeNull()
    const local = new Date(next as number).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
    expect(local).toBe('09:00')
  })
})
