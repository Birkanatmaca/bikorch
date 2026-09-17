import { describe, expect, it } from 'vitest'
import {
  allocateOrchestratorRect,
  clampOrchestratorRect,
  DEFAULT_ORCHESTRATOR_RECT,
  layoutAfterAddCenterPanel,
  minPercentFromPixels,
  ORCHESTRATOR_MIN_PX,
  orchestratorMinLimits,
  orchestratorRectsOverlap,
  type OrchestratorRect
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

  it('uses a tall phone-sized floor for canvas devices', () => {
    const limits = orchestratorMinLimits('device', { w: 1400, h: 800 })
    expect(limits.minH).toBeGreaterThan(limits.minW)
    expect(limits.minH).toBeCloseTo((320 / 800) * 100)
  })

  it('does not force the old 22×24 percent floor', () => {
    const limits = orchestratorMinLimits('panel', { w: 3000, h: 1600 })
    const next = clampOrchestratorRect({ x: 0, y: 0, w: 14, h: 16 }, limits)
    expect(next.w).toBeLessThan(22)
    expect(next.h).toBeLessThan(24)
  })
})

describe('allocateOrchestratorRect', () => {
  it('returns the default rect for an empty canvas', () => {
    expect(allocateOrchestratorRect([])).toEqual({ next: DEFAULT_ORCHESTRATOR_RECT })
  })

  it('places the second panel beside a roomy first panel without overlap', () => {
    const first: OrchestratorRect = { x: 2, y: 4, w: 40, h: 50 }
    const { next, shrinkFirst } = allocateOrchestratorRect([first])
    expect(shrinkFirst).toBeUndefined()
    expect(orchestratorRectsOverlap(first, next)).toBe(false)
    expect(next.x).toBeGreaterThanOrEqual(first.x + first.w)
  })

  it('shrinks a full-bleed first panel instead of stacking the second on top', () => {
    const { next, shrinkFirst } = allocateOrchestratorRect([DEFAULT_ORCHESTRATOR_RECT])
    expect(shrinkFirst).toBeDefined()
    expect(orchestratorRectsOverlap(shrinkFirst!, next)).toBe(false)
    expect(shrinkFirst!.w).toBeLessThan(DEFAULT_ORCHESTRATOR_RECT.w)
  })

  it('keeps successive free-form panels from stacking', () => {
    const placed: OrchestratorRect[] = []
    for (let i = 0; i < 4; i++) {
      const { next, shrinkFirst } = allocateOrchestratorRect(placed)
      if (shrinkFirst && placed[0]) placed[0] = shrinkFirst
      for (const existing of placed) {
        expect(orchestratorRectsOverlap(existing, next)).toBe(false)
      }
      placed.push(next)
    }
    expect(placed).toHaveLength(4)
  })

  it('updates layoutAfterAddCenterPanel with a non-overlapping rect', () => {
    const firstId = 'cli-1'
    const secondId = 'cli-2'
    const afterFirst = layoutAfterAddCenterPanel([], {}, firstId)
    const afterSecond = layoutAfterAddCenterPanel([firstId], afterFirst, secondId)
    expect(orchestratorRectsOverlap(afterSecond[firstId], afterSecond[secondId])).toBe(false)
  })
})
