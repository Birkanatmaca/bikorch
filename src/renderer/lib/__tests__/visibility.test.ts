import { describe, expect, it } from 'vitest'
import { visibilityScaledInterval } from '../visibility'

describe('visibilityScaledInterval', () => {
  it('leaves the interval unchanged while visible', () => {
    expect(visibilityScaledInterval(2500, 3, false)).toBe(2500)
  })

  it('slows non-critical polling while hidden and caps the delay', () => {
    expect(visibilityScaledInterval(2500, 3, true)).toBe(7500)
    expect(visibilityScaledInterval(30_000, 6, true)).toBe(120_000)
  })
})
