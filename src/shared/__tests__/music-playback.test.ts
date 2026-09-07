import { describe, expect, it } from 'vitest'
import { resolveSpotifyPlayRoute, spotifyTrackUri, spotifyWebTrackUrl } from '../music-playback'

describe('spotify play routing', () => {
  it('uses a local file only when the user has an associated offline copy', () => {
    expect(
      resolveSpotifyPlayRoute({
        id: 't1',
        source: 'spotify',
        sourceId: '11dFghVXANMlKmJXsNCbNl',
        isOfflineAvailable: true,
        filePath: '/music/cut.mp3'
      })
    ).toEqual({ kind: 'local', trackId: 't1' })
  })

  it('routes Spotify catalog items to Connect and never to YouTube', () => {
    expect(
      resolveSpotifyPlayRoute({
        id: 't1',
        source: 'spotify',
        sourceId: '11dFghVXANMlKmJXsNCbNl',
        isOfflineAvailable: false
      })
    ).toEqual({ kind: 'connect', sourceId: '11dFghVXANMlKmJXsNCbNl' })
    expect(spotifyTrackUri('11dFghVXANMlKmJXsNCbNl')).toBe('spotify:track:11dFghVXANMlKmJXsNCbNl')
    expect(spotifyWebTrackUrl('11dFghVXANMlKmJXsNCbNl')).toBe(
      'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl'
    )
  })

  it('rejects incomplete Spotify references', () => {
    expect(
      resolveSpotifyPlayRoute({
        id: 't1',
        source: 'spotify',
        isOfflineAvailable: false
      })
    ).toEqual({ kind: 'unavailable', reason: 'This Spotify reference has no track id' })
  })
})
