import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SECRETARY_MODEL,
  isValidSecretaryModelId,
  resolveSecretaryModel
} from '../model-policy'

describe('Secretary model policy', () => {
  it('keeps the model the user saved, including luna aliases', () => {
    expect(resolveSecretaryModel('gpt-5.6-luna')).toBe('gpt-5.6-luna')
    expect(resolveSecretaryModel('gpt-5.6-sol-high')).toBe('gpt-5.6-sol-high')
    expect(isValidSecretaryModelId('gpt-5.6-luna')).toBe(true)
  })

  it('preserves public or custom API model identifiers', () => {
    expect(resolveSecretaryModel('gpt-5')).toBe('gpt-5')
    expect(resolveSecretaryModel('o4-mini')).toBe('o4-mini')
  })

  it('falls back only when the saved value is empty or malformed', () => {
    expect(resolveSecretaryModel('')).toBe(DEFAULT_SECRETARY_MODEL)
    expect(resolveSecretaryModel('bad model')).toBe(DEFAULT_SECRETARY_MODEL)
    expect(isValidSecretaryModelId('bad model')).toBe(false)
  })
})
