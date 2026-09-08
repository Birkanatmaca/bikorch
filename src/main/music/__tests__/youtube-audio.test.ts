import { describe, expect, it } from 'vitest'
import { buildYouTubeAudioUrlArgs } from '../youtube-audio-args'

describe('youtube audio url args', () => {
  it('puts the watch URL after -- and prefers a fast android client', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    const args = buildYouTubeAudioUrlArgs(url, true)
    expect(args.at(-2)).toBe('--')
    expect(args.at(-1)).toBe(url)
    expect(args).toContain('-g')
    expect(args).toContain('140/bestaudio[ext=m4a]/bestaudio/best')
    expect(args).toContain('youtube:player_client=android,web')
  })

  it('can resolve without the fast extractor args', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    const args = buildYouTubeAudioUrlArgs(url, false)
    expect(args).not.toContain('--extractor-args')
    expect(args.at(-1)).toBe(url)
  })
})
