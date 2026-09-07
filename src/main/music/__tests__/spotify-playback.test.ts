import { describe, expect, it } from 'vitest'
import { mapSpotifyDevices, mapSpotifyPlaybackState } from '../spotify-map'

describe('spotify playback mapping', () => {
  it('maps devices without inventing an automatic selection', () => {
    const devices = mapSpotifyDevices({
      devices: [
        { id: 'desk-1', name: 'Computer', type: 'Computer', is_active: true, is_restricted: false },
        { id: '', name: 'Broken' },
        { id: 'phone-1', name: 'Phone', type: 'Smartphone', is_active: false, is_restricted: true }
      ]
    })
    expect(devices).toEqual([
      {
        id: 'desk-1',
        name: 'Computer',
        type: 'Computer',
        isActive: true,
        isRestricted: false,
        supportsVolume: true
      },
      {
        id: 'phone-1',
        name: 'Phone',
        type: 'Smartphone',
        isActive: false,
        isRestricted: true,
        supportsVolume: true
      }
    ])
    expect(devices.find((device) => device.isActive)?.id).toBe('desk-1')
  })

  it('maps playback state and empty player responses', () => {
    expect(mapSpotifyPlaybackState(null)).toEqual({
      trackId: null,
      deviceId: null,
      isPlaying: false,
      positionMs: 0,
      durationMs: 0,
      volume: null
    })
    expect(
      mapSpotifyPlaybackState({
        is_playing: true,
        progress_ms: 1200,
        item: {
          id: '11dFghVXANMlKmJXsNCbNl',
          name: 'Cut To The Feeling',
          duration_ms: 207_959,
          artists: [{ name: 'Carly Rae Jepsen' }]
        },
        device: { id: 'desk-1', name: 'Computer', volume_percent: 40 }
      })
    ).toEqual({
      trackId: '11dFghVXANMlKmJXsNCbNl',
      title: 'Cut To The Feeling',
      artist: 'Carly Rae Jepsen',
      deviceId: 'desk-1',
      deviceName: 'Computer',
      isPlaying: true,
      positionMs: 1200,
      durationMs: 207_959,
      volume: 40
    })
  })
})
