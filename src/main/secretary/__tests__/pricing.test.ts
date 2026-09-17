import { describe, expect, it } from 'vitest'
import { estimateSecretaryCostUsd } from '../pricing'

describe('Developer Secretary pricing', () => {
  it('estimates GPT-5 input, cached input, and output independently', () => {
    expect(estimateSecretaryCostUsd('gpt-5', {
      input_tokens: 1_000_000,
      input_tokens_details: { cached_tokens: 200_000 },
      output_tokens: 100_000
    })).toBeCloseTo(2.025, 8)
  })

  it('supports the pinned GPT-5 snapshot and chat alias', () => {
    expect(estimateSecretaryCostUsd('gpt-5-2025-08-07', { input_tokens: 1_000 })).toBe(0.00125)
    expect(estimateSecretaryCostUsd('gpt-5-chat-latest', { output_tokens: 1_000 })).toBe(0.01)
  })

  it('does not invent prices for unknown model identifiers', () => {
    expect(estimateSecretaryCostUsd('custom-model', { input_tokens: 1_000 })).toBeNull()
  })
})
