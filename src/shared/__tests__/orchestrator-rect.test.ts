import { describe, expect, it } from 'vitest'
import {
  clampOrchestratorRect,
  minPercentFromPixels,
  ORCHESTRATOR_MIN_PX,
  orchestratorMinLimits
} from '../types'

describe('orchestrator min size', () => {
  it('falls back to a percent when the canvas is unknown', () => {
    expect(minPercentFromPixels(240, 0, 10)).toBe(10)
    expect(minPercentFromPixels(240, Number.NaN, 12)).toBe(12)
    expect(orchestratorMinLimits('panel').minW).toBe(10)
    expect(orchestratorMinLimits('panel').minH).toBe(12)
  })

  it('shrinks the percent floor on a large fullscreen canvas', () => {
    const wide = orchestratorMinLimits('panel', { w: 3000, h: 1600 })
    expect(wide.minW).toBeCloseTo((ORCHESTRATOR_MIN_PX.w / 3000) * 100)
    expect(wide.minH).toBeCloseTo((ORCHESTRATOR_MIN_PX.h / 1600) * 100)
    expect(wide.minW).toBeLessThan(10)
    expect(wide.minH).toBeLessThan(12)
  })

  it('keeps a usable pixel floor on a small canvas', () => {
    const compact = orchestratorMinLimits('panel', { w: 800, h: 500 })
    expect(compact.minW).toBeCloseTo((ORCHESTRATOR_MIN_PX.w / 800) * 100)
    expect(compact.minW).toBeGreaterThan(20)
  })

  it('lets a large canvas keep a compact panel', () => {
    const limits = orchestratorMinLimits('panel', { w: 3000, h: 1600 })
    const next = clampOrchestratorRect({ x: 4, y: 4, w: 12, h: 14 }, limits)
    expect(next.w).toBeCloseTo(12)
    expect(next.h).toBeCloseTo(14)
  })

  it('does not force the old 22×24 percent floor', () => {
    const limits = orchestratorMinLimits('panel', { w: 3000, h: 1600 })
    const next = clampOrchestratorRect({ x: 0, y: 0, w: 14, h: 16 }, limits)
    expect(next.w).toBeLessThan(22)
    expect(next.h).toBeLessThan(24)
  })
})
