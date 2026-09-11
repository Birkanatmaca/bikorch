import { describe, expect, it } from 'vitest'
import {
  displayBrowserHost,
  fitViewportScale,
  looksLikeUrl,
  resolveBrowserNavigation,
  viewportWidth
} from '../browser'

describe('browser navigation', () => {
  it('detects local and remote addresses', () => {
    expect(looksLikeUrl('localhost:5173')).toBe(true)
    expect(looksLikeUrl('127.0.0.1:3000/app')).toBe(true)
    expect(looksLikeUrl('example.com')).toBe(true)
    expect(looksLikeUrl('how does flexbox work')).toBe(false)
  })

  it('opens localhost over http and sites over https', () => {
    expect(resolveBrowserNavigation('localhost:3000')).toEqual({
      ok: true,
      url: 'http://localhost:3000/'
    })
    expect(resolveBrowserNavigation('example.com/docs')).toEqual({
      ok: true,
      url: 'https://example.com/docs'
    })
  })

  it('turns loose text into a search', () => {
    const result = resolveBrowserNavigation('css grid gap')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.url).toContain('duckduckgo.com')
    expect(result.url).toContain('css%20grid%20gap')
  })

  it('rejects dangerous schemes', () => {
    expect(resolveBrowserNavigation('javascript:alert(1)').ok).toBe(false)
    expect(resolveBrowserNavigation('file:///etc/passwd').ok).toBe(false)
  })
})

describe('browser viewport', () => {
  it('uses phone and custom widths', () => {
    expect(viewportWidth('phone', 800)).toBe(390)
    expect(viewportWidth('custom', 820)).toBe(820)
    expect(viewportWidth('fluid', 800)).toBeNull()
  })

  it('scales a wide frame down to fit the panel', () => {
    expect(fitViewportScale(640, 1280)).toBeCloseTo(0.5)
    expect(fitViewportScale(1400, 1280)).toBe(1)
  })

  it('reads the host for the chrome label', () => {
    expect(displayBrowserHost('http://localhost:5173/app')).toBe('localhost:5173')
  })
})
