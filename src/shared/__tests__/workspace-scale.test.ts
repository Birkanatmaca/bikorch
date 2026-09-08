import { describe, expect, it } from 'vitest'
import {
  clampWorkspaceScale,
  WORKSPACE_SCALE_DEFAULT,
  WORKSPACE_SCALE_MAX,
  WORKSPACE_SCALE_MIN
} from '../types'

describe('workspace scale', () => {
  it('defaults invalid values to 100', () => {
    expect(clampWorkspaceScale(Number.NaN)).toBe(WORKSPACE_SCALE_DEFAULT)
    expect(clampWorkspaceScale(Number.POSITIVE_INFINITY)).toBe(WORKSPACE_SCALE_DEFAULT)
  })

  it('snaps to ten-percent steps inside 50–200', () => {
    expect(clampWorkspaceScale(80)).toBe(80)
    expect(clampWorkspaceScale(84)).toBe(80)
    expect(clampWorkspaceScale(86)).toBe(90)
    expect(clampWorkspaceScale(40)).toBe(WORKSPACE_SCALE_MIN)
    expect(clampWorkspaceScale(240)).toBe(WORKSPACE_SCALE_MAX)
  })
})
