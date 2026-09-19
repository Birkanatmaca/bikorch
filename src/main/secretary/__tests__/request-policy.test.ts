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

  it('keeps common failures safe while preserving useful validation details', () => {
    expect(secretaryRequestError(401).message).toMatch(/API key was rejected/i)
    expect(secretaryRequestError(429).message).toMatch(/rate-limited/i)
    expect(secretaryNetworkError(true).message).toMatch(/timed out/i)
    expect(secretaryRequestError(400, 'The model gpt-5.6-luna is not available').message)
      .toMatch(/gpt-5\.6-luna/)
    expect(secretaryRequestError(400, 'Bearer sk-secret-value').message)
      .not.toContain('sk-secret-value')
  })
})
