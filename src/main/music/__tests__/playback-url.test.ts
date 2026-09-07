import { describe, expect, it } from 'vitest'
import { parseMusicResource, parseTrackPlaybackId, trackArtworkUrl, trackPlaybackUrl } from '@shared/contracts/music'

describe('music playback URL', () => {
  it('round-trips a track id through the custom protocol', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000'
    expect(parseTrackPlaybackId(trackPlaybackUrl(id))).toBe(id)
  })

  it('round-trips artwork through the same protocol', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000'
    expect(parseMusicResource(trackArtworkUrl(id))).toEqual({ kind: 'art', id })
    expect(parseTrackPlaybackId(trackArtworkUrl(id))).toBeNull()
  })

  it('accepts the older host-style URL that used to 404', () => {
    const id = 'track-1'
    expect(parseTrackPlaybackId(`bikorch-music://track/${id}`)).toBe(id)
  })

  it('rejects unrelated URLs', () => {
    expect(parseTrackPlaybackId('https://example.com/track/1')).toBeNull()
  })

  it('still reads the track id when a cache-busting query is present', () => {
    const id = 'track-1'
    expect(parseTrackPlaybackId(`${trackPlaybackUrl(id)}?t=123`)).toBe(id)
  })
})
