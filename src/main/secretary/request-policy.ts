export const SECRETARY_REQUEST_TIMEOUT_MS = 45_000
export const SECRETARY_MAX_REQUEST_ATTEMPTS = 2

export function isRetryableSecretaryStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

function safeErrorDetail(detail: unknown): string | null {
  if (typeof detail !== 'string') return null
  const normalized = detail.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  const redacted = normalized
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
  return redacted.slice(0, 240)
}

export function secretaryRequestError(status: number, detail?: unknown): Error {
  if (status === 401 || status === 403) {
    return new Error('The Secretary API key was rejected. Check it in Profile settings.')
  }
  if (status === 429) {
    return new Error('The Secretary API is rate-limited. Please try again shortly.')
  }
  if (status >= 500) {
    return new Error('The Secretary API is temporarily unavailable. Please try again shortly.')
  }
  const suffix = safeErrorDetail(detail)
  return new Error(`The Secretary request could not be completed (${status}).${suffix ? ` ${suffix}` : ''}`)
}

export function secretaryNetworkError(timedOut: boolean): Error {
  return timedOut
    ? new Error('The Secretary request timed out. Please try again.')
    : new Error('The Secretary request could not reach the API. Check your connection and try again.')
}
