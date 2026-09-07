import { describe, expect, it } from 'vitest'
import { isAudioExtension, metadataFromFilename } from '../metadata'

describe('metadataFromFilename', () => {
  it('parses artist-title patterns', () => {
    expect(metadataFromFilename('/music/Hans Zimmer - Mountains.mp3')).toEqual({
      artist: 'Hans Zimmer',
      title: 'Mountains'
    })
  })

  it('falls back to the filename stem', () => {
    expect(metadataFromFilename('C:\\tracks\\focus_mix.wav')).toEqual({ title: 'focus_mix' })
  })
})

describe('isAudioExtension', () => {
  it('accepts common audio extensions', () => {
    expect(isAudioExtension('.mp3')).toBe(true)
    expect(isAudioExtension('.FLAC')).toBe(true)
    expect(isAudioExtension('.webm')).toBe(true)
    expect(isAudioExtension('.txt')).toBe(false)
  })
})
