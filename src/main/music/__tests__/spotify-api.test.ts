import { describe, expect, it } from 'vitest'
import { isSpotifyTimeRange, isSpotifyTrackId, mapSpotifyApiTrack } from '../spotify-map'

describe('spotify catalog mapping', () => {
  it('maps a Web API track into a library reference', () => {
    const mapped = mapSpotifyApiTrack({
      id: '11dFghVXANMlKmJXsNCbNl',
      name: 'Cut To The Feeling',
      duration_ms: 207_959,
      artists: [{ name: 'Carly Rae Jepsen' }],
      album: {
        images: [
          { url: 'https://i.scdn.co/image/small', width: 64 },
          { url: 'https://i.scdn.co/image/large', width: 640 }
        ]
      }
    })
    expect(mapped).toEqual({
      sourceId: '11dFghVXANMlKmJXsNCbNl',
      title: 'Cut To The Feeling',
      artist: 'Carly Rae Jepsen',
      durationMs: 207_959,
      sourceUrl: 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
      artworkUrl: 'https://i.scdn.co/image/large'
    })
  })

  it('rejects incomplete payloads and invalid ids', () => {
    expect(mapSpotifyApiTrack({ id: 'short', name: 'Nope' })).toBeNull()
    expect(mapSpotifyApiTrack({ id: '11dFghVXANMlKmJXsNCbNl' })).toBeNull()
    expect(isSpotifyTrackId('11dFghVXANMlKmJXsNCbNl')).toBe(true)
    expect(isSpotifyTimeRange('long_term')).toBe(true)
    expect(isSpotifyTimeRange('forever')).toBe(false)
  })
})
