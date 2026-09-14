import { describe, expect, it } from 'vitest'
import { describeAutomationSchedule } from '../automation'

describe('describeAutomationSchedule', () => {
  it('does not throw on missing or malformed schedules', () => {
    expect(describeAutomationSchedule(undefined)).toBe('Unscheduled')
    expect(describeAutomationSchedule(null)).toBe('Unscheduled')
    expect(describeAutomationSchedule({} as never)).toBe('Custom schedule')
    expect(
      describeAutomationSchedule({ kind: 'weekly', days: [1], localTime: '09:00', timeZone: 'UTC' })
    ).toContain('Mon')
  })
})
