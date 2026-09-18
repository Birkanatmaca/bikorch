export const SECRETARY_REQUEST_TIMEOUT_MS = 45_000
export const SECRETARY_MAX_REQUEST_ATTEMPTS = 2

export function isRetryableSecretaryStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

export function secretaryRequestError(status: number): Error {
  if (status === 401 || status === 403) {
    return new Error('The Secretary API key was rejected. Check it in Profile settings.')
  }
  if (status === 429) {
    return new Error('The Secretary API is rate-limited. Please try again shortly.')
  }
  if (status >= 500) {
    return new Error('The Secretary API is temporarily unavailable. Please try again shortly.')
  }
  return new Error(`The Secretary request could not be completed (${status}).`)
}

export function secretaryNetworkError(timedOut: boolean): Error {
  return timedOut
    ? new Error('The Secretary request timed out. Please try again.')
    : new Error('The Secretary request could not reach the API. Check your connection and try again.')
}
