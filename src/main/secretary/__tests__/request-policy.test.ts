import { describe, expect, it } from 'vitest'
import {
  isRetryableSecretaryStatus,
  secretaryNetworkError,
  secretaryRequestError
} from '../request-policy'

describe('Secretary request policy', () => {
  it('retries only transient API status codes', () => {
    expect(isRetryableSecretaryStatus(429)).toBe(true)
    expect(isRetryableSecretaryStatus(503)).toBe(true)
    expect(isRetryableSecretaryStatus(401)).toBe(false)
    expect(isRetryableSecretaryStatus(400)).toBe(false)
  })

  it('does not expose response bodies or credentials in user-facing failures', () => {
    expect(secretaryRequestError(401).message).toMatch(/API key was rejected/i)
    expect(secretaryRequestError(429).message).toMatch(/rate-limited/i)
    expect(secretaryNetworkError(true).message).toMatch(/timed out/i)
  })
})
