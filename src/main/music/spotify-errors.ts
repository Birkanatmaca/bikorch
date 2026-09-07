import type { SpotifyError, SpotifyErrorCode } from '@shared/contracts/music'

interface SpotifyErrorBody {
  error?: {
    status?: number
    message?: string
    reason?: string
  }
}

export function spotifyError(
  code: SpotifyErrorCode,
  message: string,
  extras?: { httpStatus?: number; retryAfterMs?: number }
): SpotifyError {
  return {
    code,
    message,
    ...(extras?.httpStatus !== undefined ? { httpStatus: extras.httpStatus } : {}),
    ...(extras?.retryAfterMs !== undefined ? { retryAfterMs: extras.retryAfterMs } : {})
  }
}

export function parseSpotifyErrorBody(raw: string): { message?: string; reason?: string; status?: number } {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed) as SpotifyErrorBody
    const error = parsed.error
    if (!error || typeof error !== 'object') return {}
    return {
      ...(typeof error.message === 'string' ? { message: error.message.slice(0, 240) } : {}),
      ...(typeof error.reason === 'string' ? { reason: error.reason } : {}),
      ...(typeof error.status === 'number' ? { status: error.status } : {})
    }
  } catch {
    return { message: trimmed.slice(0, 240) }
  }
}

export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, Math.round(seconds * 1000))
  return undefined
}

export function classifySpotifyHttpError(input: {
  status: number
  body?: string
  retryAfter?: string | null
  endpoint?: string
}): SpotifyError {
  const parsed = parseSpotifyErrorBody(input.body ?? '')
  const reason = (parsed.reason ?? '').toUpperCase()
  const message = (parsed.message ?? '').toLowerCase()
  const extras = { httpStatus: input.status }

  if (input.status === 401) {
    return spotifyError('TOKEN_EXPIRED', 'Spotify session expired. Connect again.', extras)
  }

  if (input.status === 429) {
    return spotifyError(
      'RATE_LIMITED',
      'Spotify rate-limited this request. Try again in a moment.',
      { ...extras, retryAfterMs: parseRetryAfterMs(input.retryAfter ?? null) }
    )
  }

  if (input.status === 404) {
    if (message.includes('device') || input.endpoint?.includes('player')) {
      return spotifyError(
        'NO_ACTIVE_DEVICE',
        'No ready Spotify device. Open Spotify, then select that device in Bikorch.',
        extras
      )
    }
    return spotifyError('UNKNOWN', parsed.message ?? 'Spotify could not find that resource.', extras)
  }

  if (input.status === 403) {
    if (reason === 'PREMIUM_REQUIRED' || message.includes('premium required')) {
      return spotifyError(
        'PREMIUM_REQUIRED',
        'This playback command needs a Spotify Premium account.',
        extras
      )
    }
    if (
      reason === 'INSUFFICIENT_CLIENT_SCOPE' ||
      message.includes('insufficient client scope') ||
      message.includes('insufficient scope')
    ) {
      return spotifyError(
        'INSUFFICIENT_SCOPE',
        'Spotify needs extra permissions. Disconnect and connect again to grant them.',
        extras
      )
    }
    if (
      reason.includes('RESTRICT') ||
      message.includes('restricted') ||
      message.includes('not available') ||
      message.includes('right')
    ) {
      return spotifyError(
        'PLAYBACK_RESTRICTED',
        parsed.message ?? 'Spotify restricted playback for this track or device.',
        extras
      )
    }
    if (
      message.includes('quota') ||
      message.includes('developer mode') ||
      message.includes('user may not be registered') ||
      message.includes('forbidden')
    ) {
      return spotifyError(
        'APP_ACCESS_RESTRICTED',
        'This Spotify app cannot use that endpoint yet. Check the dashboard access mode and allowlist.',
        extras
      )
    }
    return spotifyError(
      'APP_ACCESS_RESTRICTED',
      parsed.message ?? 'Spotify denied this request. This is not always a Premium problem.',
      extras
    )
  }

  if (input.status === 400) {
    if (message.includes('device') || reason.includes('DEVICE')) {
      return spotifyError(
        'DEVICE_NOT_READY',
        parsed.message ?? 'The selected Spotify device is not ready. Refresh devices and pick it again.',
        extras
      )
    }
    return spotifyError('UNKNOWN', parsed.message ?? 'Spotify rejected the playback request.', extras)
  }

  if (input.status >= 500) {
    return spotifyError('NETWORK_ERROR', 'Spotify is temporarily unavailable.', extras)
  }

  return spotifyError('UNKNOWN', parsed.message ?? `Spotify request failed (${input.status}).`, extras)
}

export function formatSpotifyError(error: SpotifyError): string {
  return error.message
}
