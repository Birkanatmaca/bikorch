import { describe, expect, it } from 'vitest'
import { parseDirectAudioUrl, parseMusicUrl } from '../url-parser'

describe('parseMusicUrl', () => {
  it('parses youtube watch URLs', () => {
    const parsed = parseMusicUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(parsed).toEqual({
      source: 'youtube',
      sourceId: 'dQw4w9WgXcQ',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    })
  })

  it('parses spotify track URLs', () => {
    const parsed = parseMusicUrl('https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl')
    expect(parsed).toEqual({
      source: 'spotify',
      sourceId: '11dFghVXANMlKmJXsNCbNl',
      sourceUrl: 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl'
    })
  })
})

describe('parseDirectAudioUrl', () => {
  it('accepts direct mp3 links', () => {
    expect(parseDirectAudioUrl('https://cdn.example.com/song.mp3')).toBe(
      'https://cdn.example.com/song.mp3'
    )
  })

  it('rejects youtube links', () => {
    expect(parseDirectAudioUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})
