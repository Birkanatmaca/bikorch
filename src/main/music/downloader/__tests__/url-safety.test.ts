import { describe, expect, it } from 'vitest'
import { isPrivateResolvedAddress, mapEngineError, validateDownloadUrl } from '../url-safety'

describe('validateDownloadUrl', () => {
  it('accepts public https URLs', () => {
    const result = validateDownloadUrl('https://example.com/watch?v=abc')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toBe('https://example.com/watch?v=abc')
  })

  it('rejects local and internal destinations', () => {
    expect(validateDownloadUrl('http://127.0.0.1/a.mp3').ok).toBe(false)
    expect(validateDownloadUrl('http://localhost/a.mp3').ok).toBe(false)
    expect(validateDownloadUrl('http://192.168.1.5/a.mp3').ok).toBe(false)
    expect(validateDownloadUrl('http://10.0.0.8/a.mp3').ok).toBe(false)
    expect(validateDownloadUrl('http://169.254.1.1/a.mp3').ok).toBe(false)
    expect(validateDownloadUrl('file:///tmp/a.mp3').ok).toBe(false)
  })

  it('rejects credentials and blocked DRM hosts', () => {
    expect(validateDownloadUrl('https://user:pass@example.com/a').ok).toBe(false)
    expect(validateDownloadUrl('https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl').ok).toBe(false)
    expect(validateDownloadUrl('https://www.netflix.com/watch/1').ok).toBe(false)
  })

  it('rejects whitespace and oversized URLs', () => {
    expect(validateDownloadUrl('https://example.com/a b').ok).toBe(false)
    expect(validateDownloadUrl(`https://example.com/${'a'.repeat(3000)}`).ok).toBe(false)
  })
})

describe('isPrivateResolvedAddress', () => {
  it('detects DNS-resolved private addresses', () => {
    expect(isPrivateResolvedAddress('127.0.0.1')).toBe(true)
    expect(isPrivateResolvedAddress('10.1.2.3')).toBe(true)
    expect(isPrivateResolvedAddress('8.8.8.8')).toBe(false)
  })
})

describe('mapEngineError', () => {
  it('maps protected and unavailable sources without leaking internals', () => {
    expect(mapEngineError('ERROR: DRM protected stream', 1)).toMatch(/protected/i)
    expect(mapEngineError('ERROR: Sign in to confirm', 1)).toMatch(/authentication/i)
    expect(mapEngineError('ERROR: Unsupported URL', 1)).toMatch(/not supported/i)
  })
})
