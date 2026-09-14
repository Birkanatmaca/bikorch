import { describe, expect, it } from 'vitest'
import { resourceLimitsFor } from '@shared/contracts/resources'
import { shouldAutoStopIdleCli } from '../idle-policy'

describe('idle CLI policy', () => {
  it('never auto-stops CLIs on the shipped profiles', () => {
    expect(shouldAutoStopIdleCli(resourceLimitsFor('balanced'), 60 * 60_000)).toBe(false)
    expect(shouldAutoStopIdleCli(resourceLimitsFor('memory-saver'), 60 * 60_000)).toBe(false)
    expect(shouldAutoStopIdleCli(resourceLimitsFor('performance'), 10_000)).toBe(false)
  })
})
