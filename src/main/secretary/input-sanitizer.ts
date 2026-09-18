import { redactSecrets } from '../developer-intelligence/redaction'

/** Bounds and redacts every untrusted free-text field before it reaches the API. */
export function sanitizeSecretaryModelText(value: string, maxLength = 8_000): string {
  return redactSecrets(value).text.trim().slice(0, maxLength)
}
