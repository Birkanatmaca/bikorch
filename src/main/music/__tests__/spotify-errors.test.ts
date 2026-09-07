import { describe, expect, it } from 'vitest'
import {
  classifySpotifyHttpError,
  parseRetryAfterMs,
  parseSpotifyErrorBody
} from '../spotify-errors'

describe('spotify error mapping', () => {
  it('does not treat every 403 as Premium required', () => {
    expect(
      classifySpotifyHttpError({
        status: 403,
        body: JSON.stringify({ error: { status: 403, message: 'Insufficient client scope' } })
      }).code
    ).toBe('INSUFFICIENT_SCOPE')

    expect(
      classifySpotifyHttpError({
        status: 403,
        body: JSON.stringify({
          error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' }
        })
      }).code
    ).toBe('PREMIUM_REQUIRED')

    expect(
      classifySpotifyHttpError({
        status: 403,
        body: JSON.stringify({ error: { status: 403, message: 'Forbidden' } })
      }).code
    ).toBe('APP_ACCESS_RESTRICTED')
  })

  it('maps device and rate-limit failures', () => {
    expect(classifySpotifyHttpError({ status: 404, endpoint: '/v1/me/player/play' }).code).toBe(
      'NO_ACTIVE_DEVICE'
    )
    expect(
      classifySpotifyHttpError({ status: 429, retryAfter: '2' }).retryAfterMs
    ).toBe(2000)
    expect(classifySpotifyHttpError({ status: 401 }).code).toBe('TOKEN_EXPIRED')
  })

  it('parses provider bodies without leaking raw dumps', () => {
    expect(parseSpotifyErrorBody('{"error":{"message":"nope","reason":"PREMIUM_REQUIRED"}}')).toEqual({
      message: 'nope',
      reason: 'PREMIUM_REQUIRED'
    })
    expect(parseRetryAfterMs('1.5')).toBe(1500)
    expect(parseRetryAfterMs('nope')).toBeUndefined()
  })
})
