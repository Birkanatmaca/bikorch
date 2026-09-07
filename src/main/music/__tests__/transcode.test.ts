import { describe, expect, it } from 'vitest'
import { buildAacM4aArgs, buildMp3Args, needsPlaybackTranscode, sameAudioPath } from '../transcode'

describe('playback transcode', () => {
  it('flags webm/opus for conversion and leaves m4a/mp3 alone', () => {
    expect(needsPlaybackTranscode('C:\\music\\mix.webm')).toBe(true)
    expect(needsPlaybackTranscode('C:\\music\\mix.opus')).toBe(true)
    expect(needsPlaybackTranscode('C:\\music\\mix.m4a')).toBe(false)
    expect(needsPlaybackTranscode('C:\\music\\mix.mp3')).toBe(false)
  })

  it('builds a discrete ffmpeg MP3 command for the player', () => {
    const args = buildMp3Args('C:\\in.webm', 'C:\\out.mp3')
    expect(args[0]).toBe('-y')
    expect(args).toContain('-i')
    expect(args).toContain('C:\\in.webm')
    expect(args).toContain('libmp3lame')
    expect(args.at(-1)).toBe('C:\\out.mp3')
    expect(args.join(' ')).not.toContain('&&')
  })

  it('does not treat the same mp3 path as a new ffmpeg output', () => {
    expect(sameAudioPath('C:\\lib\\track.mp3', 'C:/lib/track.mp3')).toBe(true)
    expect(sameAudioPath('C:\\lib\\track.mp3', 'C:\\lib\\track.play.mp3')).toBe(false)
  })

  it('keeps the AAC helper as discrete argv tokens', () => {
    const args = buildAacM4aArgs('C:\\in.webm', 'C:\\out.m4a')
    expect(args).toContain('aac')
    expect(args.at(-1)).toBe('C:\\out.m4a')
  })
})
