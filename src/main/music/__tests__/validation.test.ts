import { describe, expect, it } from 'vitest'
import {
  parseCreatePlaylist,
  parseEnsurePlayable,
  parseImportPaths,
  parsePlaybackSnapshot,
  parseSettingsUpdate,
  parseYouTubeSearchQuery
} from '../validation'

describe('music validation', () => {
  it('parses import paths', () => {
    expect(parseImportPaths({ paths: ['C:/a.mp3'] })).toEqual({ paths: ['C:/a.mp3'] })
    expect(parseImportPaths({ paths: ['C:/a.mp3'], mode: 'managed' })).toEqual({
      paths: ['C:/a.mp3'],
      mode: 'managed'
    })
    expect(parseImportPaths({ paths: [] })).toBeNull()
  })

  it('parses playlist and settings updates', () => {
    expect(parseCreatePlaylist({ name: ' Focus ' })).toEqual({ name: 'Focus' })
    expect(parseSettingsUpdate({ keepListeningHistory: true, libraryMode: 'managed' })).toEqual({
      keepListeningHistory: true,
      libraryMode: 'managed'
    })
  })

  it('parses playback snapshots', () => {
    expect(
      parsePlaybackSnapshot({
        trackId: 't1',
        positionMs: 1200,
        volume: 1.5,
        shuffle: true,
        repeat: 'all',
        queueTrackIds: ['t1', 't2']
      })
    ).toMatchObject({
      trackId: 't1',
      positionMs: 1200,
      volume: 1,
      shuffle: true,
      repeat: 'all',
      queueTrackIds: ['t1', 't2']
    })
  })

  it('parses ensure-playable payloads', () => {
    expect(parseEnsurePlayable('track-1')).toEqual({ trackId: 'track-1', force: false })
    expect(parseEnsurePlayable({ trackId: 'track-1', force: true })).toEqual({
      trackId: 'track-1',
      force: true
    })
  })

  it('parses YouTube search queries', () => {
    expect(parseYouTubeSearchQuery('  night drive ')).toBe('night drive')
    expect(parseYouTubeSearchQuery({ query: 'lofi beats' })).toBe('lofi beats')
    expect(parseYouTubeSearchQuery('a')).toBeNull()
  })
})
