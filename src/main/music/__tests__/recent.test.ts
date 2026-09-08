import { describe, expect, it } from 'vitest'
import type { MusicTrack } from '@shared/contracts/music'
import { uniqueRecentlyPlayed } from '../recent'

function track(partial: Partial<MusicTrack> & Pick<MusicTrack, 'id' | 'title' | 'lastPlayedAt'>): MusicTrack {
  return {
    source: 'youtube',
    isOfflineAvailable: false,
    storageMode: 'reference',
    addedAt: 1,
    playCount: 1,
    ...partial
  }
}

describe('uniqueRecentlyPlayed', () => {
  it('keeps one row per song and moves the latest play to the top', () => {
    const older = track({
      id: 'a',
      title: 'Dudu',
      sourceId: 'SCZgGVqVsbY',
      lastPlayedAt: 1000
    })
    const other = track({
      id: 'b',
      title: 'Şımarık',
      sourceId: 'cpp69ghR1IM',
      lastPlayedAt: 2000
    })
    const replayed = track({
      id: 'a',
      title: 'Dudu',
      sourceId: 'SCZgGVqVsbY',
      lastPlayedAt: 5000
    })

    expect(uniqueRecentlyPlayed([older, other, replayed]).map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('does not list a song twice even with different row ids for the same source', () => {
    const first = track({ id: 'one', title: 'Dudu', sourceId: 'SCZgGVqVsbY', lastPlayedAt: 10 })
    const copy = track({ id: 'two', title: 'Dudu', sourceId: 'SCZgGVqVsbY', lastPlayedAt: 20 })
    expect(uniqueRecentlyPlayed([first, copy])).toHaveLength(1)
    expect(uniqueRecentlyPlayed([first, copy])[0]?.id).toBe('two')
  })
})
