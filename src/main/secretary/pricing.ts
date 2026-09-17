export interface SecretaryResponseUsage {
  input_tokens?: unknown
  input_tokens_details?: { cached_tokens?: unknown }
  output_tokens?: unknown
  total_tokens?: unknown
}

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

/** GPT-5 standard text pricing, in USD per one million tokens. */
export function estimateSecretaryCostUsd(model: string, usage: SecretaryResponseUsage): number | null {
  if (!/^gpt-5(?:$|-2025-08-07$|-chat-latest$)/.test(model)) return null
  const input = tokenCount(usage.input_tokens)
  const cached = Math.min(input, tokenCount(usage.input_tokens_details?.cached_tokens))
  const output = tokenCount(usage.output_tokens)
  return (((input - cached) * 1.25) + (cached * 0.125) + (output * 10)) / 1_000_000
}
