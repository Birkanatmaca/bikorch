import { describe, expect, it } from 'vitest'
import { normalizeContainedPointer, unrotatePoint } from '../simulator-geometry'

describe('simulator pointer mapping', () => {
  it('maps the contained image and ignores the letterbox', () => {
    const box = { width: 200, height: 400 }
    const media = { width: 100, height: 300 }
    expect(normalizeContainedPointer(box, media, 100, 200)).toEqual({ x: 0.5, y: 0.5 })
    expect(normalizeContainedPointer(box, media, 4, 200)).toBeNull()
  })
})

describe('touches on a turned device', () => {
  it('maps the turned picture back to the portrait digitizer', () => {
    // Turned left, the button iOS drew at portrait (0.38, 0.62) shows at (0.62, 0.62).
    const touch = unrotatePoint({ x: 0.62, y: 0.62 }, 270)
    expect(touch.x).toBeCloseTo(0.38)
    expect(touch.y).toBeCloseTo(0.62)
    // Corners: what shows top-left comes from portrait bottom-left (left) or top-right (right).
    expect(unrotatePoint({ x: 0, y: 0 }, 270)).toEqual({ x: 1, y: 0 })
    expect(unrotatePoint({ x: 0, y: 0 }, 90)).toEqual({ x: 0, y: 1 })
    expect(unrotatePoint({ x: 0.2, y: 0.7 }, 0)).toEqual({ x: 0.2, y: 0.7 })
  })
})
