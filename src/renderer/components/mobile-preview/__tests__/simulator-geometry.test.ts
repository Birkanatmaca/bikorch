import { describe, expect, it } from 'vitest'
import { normalizeContainedPointer } from '../simulator-geometry'

describe('simulator pointer mapping', () => {
  it('maps the contained image and ignores the letterbox', () => {
    const box = { width: 200, height: 400 }
    const media = { width: 100, height: 300 }
    expect(normalizeContainedPointer(box, media, 100, 200)).toEqual({ x: 0.5, y: 0.5 })
    expect(normalizeContainedPointer(box, media, 4, 200)).toBeNull()
  })
})
