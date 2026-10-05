import { describe, expect, it } from 'vitest'
import { fitDeviceRectToAspect, resizeDeviceRect } from '../device-rect'
import {
  MOBILE_DEVICE_MODELS,
  mobileDeviceAspect,
  mobileDeviceGeometry,
  mobileModelsFor,
  resolveMobileModel
} from '../mobile-devices'

const canvas = { w: 1600, h: 1000 }

function pxAspect(rect: { w: number; h: number }): number {
  return ((rect.w / 100) * canvas.w) / ((rect.h / 100) * canvas.h)
}

describe('mobile device catalog', () => {
  it('offers six iOS and five Android models with unique IDs', () => {
    expect(mobileModelsFor('ios')).toHaveLength(6)
    expect(mobileModelsFor('android')).toHaveLength(5)
    expect(new Set(MOBILE_DEVICE_MODELS.map((model) => model.id)).size).toBe(MOBILE_DEVICE_MODELS.length)
  })

  it('falls back to the platform default for unknown or other-platform models', () => {
    expect(resolveMobileModel('ios', 'pixel-8').id).toBe('iphone-16-pro')
    expect(resolveMobileModel('android', undefined).id).toBe('pixel-8')
    expect(resolveMobileModel('ios', 'iphone-se').name).toBe('iPhone SE')
  })

  it('places the screen at the exact CSS viewport inside the frame', () => {
    for (const model of MOBILE_DEVICE_MODELS) {
      const { frame, screen, cutout } = mobileDeviceGeometry(model)
      expect(screen.w).toBe(model.viewport.w)
      expect(screen.h).toBe(model.viewport.h)
      expect(screen.x + screen.w).toBeLessThanOrEqual(frame.w)
      expect(screen.y + screen.h).toBeLessThanOrEqual(frame.h)
      expect(cutout.x).toBeGreaterThanOrEqual(0)
      expect(cutout.x + cutout.w).toBeLessThanOrEqual(frame.w)
    }
  })

  it('gives home-button phones a home button instead of a gesture bar', () => {
    const se = mobileDeviceGeometry(resolveMobileModel('ios', 'iphone-se'))
    expect(se.homeButton).not.toBeNull()
    expect(se.indicator).toBeNull()
    expect(mobileDeviceGeometry(resolveMobileModel('ios', 'iphone-16-pro')).indicator).not.toBeNull()
  })
})

describe('device rect resizing', () => {
  const aspect = mobileDeviceAspect(resolveMobileModel('ios', 'iphone-16-pro'))
  const start = fitDeviceRectToAspect({ x: 10, y: 10, w: 20, h: 60 }, canvas, aspect)

  it('fits a window to the device ratio', () => {
    expect(pxAspect(start)).toBeCloseTo(aspect, 4)
    expect(start.h).toBeCloseTo(60, 4)
  })

  it('keeps the ratio and the opposite corner fixed while dragging any corner', () => {
    for (const corner of ['se', 'sw', 'ne', 'nw'] as const) {
      const next = resizeDeviceRect(start, corner, 80, 20, canvas, aspect)
      expect(pxAspect(next)).toBeCloseTo(aspect, 4)
    }
    const grown = resizeDeviceRect(start, 'se', 60, 60, canvas, aspect)
    expect(grown.x).toBeCloseTo(start.x, 6)
    expect(grown.y).toBeCloseTo(start.y, 6)
    expect(grown.h).toBeGreaterThan(start.h)
    const fromTopLeft = resizeDeviceRect(start, 'nw', -40, -40, canvas, aspect)
    expect(fromTopLeft.x + fromTopLeft.w).toBeCloseTo(start.x + start.w, 6)
    expect(fromTopLeft.y + fromTopLeft.h).toBeCloseTo(start.y + start.h, 6)
  })

  it('stops at the canvas edge and at the minimum size', () => {
    const huge = resizeDeviceRect(start, 'se', 5000, 5000, canvas, aspect)
    expect(huge.y + huge.h).toBeLessThanOrEqual(100.0001)
    expect(huge.x + huge.w).toBeLessThanOrEqual(100.0001)
    expect(pxAspect(huge)).toBeCloseTo(aspect, 4)
    const tiny = resizeDeviceRect(start, 'se', -5000, -5000, canvas, aspect)
    expect((tiny.h / 100) * canvas.h).toBeGreaterThanOrEqual(320)
  })
})
