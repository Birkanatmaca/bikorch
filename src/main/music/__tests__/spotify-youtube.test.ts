import { describe, expect, it } from 'vitest'
import { buildYouTubeSearchTerm, extractYouTubeVideoId, isYouTubeVideoId } from '../spotify-youtube-search'

describe('spotify to youtube search', () => {
  it('builds a compact search term from artist and title', () => {
    expect(buildYouTubeSearchTerm('DYSTINCT', 'YAMA')).toBe('DYSTINCT YAMA')
    expect(buildYouTubeSearchTerm('A | B', 'Cut\nTo The Feeling')).toBe('A B Cut To The Feeling')
  })

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
})
