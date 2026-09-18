import { describe, expect, it } from 'vitest'
import { sanitizeSecretaryModelText } from '../input-sanitizer'

describe('Secretary model input sanitizer', () => {
  it('redacts secrets from terminal or chat text before sending it to the API', () => {
    const sanitized = sanitizeSecretaryModelText('Terminal tail: sk-proj-abcdefghijklmnopqrstuvwxyz1234567890')
    expect(sanitized).toContain('[REDACTED]')
    expect(sanitized).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz1234567890')
  })

  it('keeps the model input bounded', () => {
    expect(sanitizeSecretaryModelText('x'.repeat(100), 10)).toHaveLength(10)
  })
})
