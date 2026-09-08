import { describe, expect, it } from 'vitest'
import {
  extractYouTubeSearchHits,
  extractYouTubeVideoId,
  isYouTubeVideoId,
  mapYouTubeSearchHit,
  sanitizeYouTubeSearchQuery
} from '../youtube-ids'

describe('youtube search mapping', () => {
  it('accepts YouTube video ids only', () => {
    expect(isYouTubeVideoId('dQw4w9WgXcQ')).toBe(true)
    expect(isYouTubeVideoId('short')).toBe(false)
  })

  it('extracts a video id from yt-dlp search JSON', () => {
    expect(
      extractYouTubeVideoId({
        _type: 'playlist',
        entries: [{ id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }]
      })
    ).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeVideoId({ webpage_url: 'https://youtu.be/dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ')
  })

  it('maps a playlist dump into unique search hits', () => {
    const hits = extractYouTubeSearchHits({
      _type: 'playlist',
      entries: [
        {
          id: 'dQw4w9WgXcQ',
          title: 'Never Gonna Give You Up',
          uploader: 'Rick Astley',
          duration: 213,
          thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg'
        },
        { id: 'dQw4w9WgXcQ', title: 'duplicate' },
        { id: 'aaaaaaaaaaa', title: 'Second' },
        { id: 'bbbbbbbbbbb', title: 'Third' },
        { id: 'ccccccccccc', title: 'Fourth' },
        { id: 'short' }
      ]
    })
    expect(hits.map((hit) => hit.videoId)).toEqual(['dQw4w9WgXcQ', 'aaaaaaaaaaa', 'bbbbbbbbbbb'])
    expect(hits[0]).toEqual({
      videoId: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      channel: 'Rick Astley',
      durationSec: 213,
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    })
  })

  it('falls back to a default thumbnail and sanitizes queries', () => {
    expect(mapYouTubeSearchHit({ id: 'abcdefghijk' })?.thumbnailUrl).toBe(
      'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg'
    )
    expect(sanitizeYouTubeSearchQuery('  night  drive\n ')).toBe('night drive')
    expect(sanitizeYouTubeSearchQuery('a')).toBeNull()
  })
})
