import { describe, expect, it } from 'vitest'
import { isElectronPlayable, mimeForAudioKind, sniffAudioKind } from '../audio-format'

describe('audio sniffing', () => {
  it('recognizes Chromium-safe containers and rejects WebM/Opus', () => {
    expect(sniffAudioKind(Buffer.from('ID3\x04\x00\x00'))).toBe('mp3')
    expect(sniffAudioKind(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe('mp3')
    const m4a = Buffer.alloc(12)
    m4a.write('ftyp', 4)
    expect(sniffAudioKind(m4a)).toBe('m4a')
    expect(sniffAudioKind(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe('webm')
    expect(sniffAudioKind(Buffer.from('OggS'))).toBe('ogg')
    expect(isElectronPlayable('mp3')).toBe(true)
    expect(isElectronPlayable('m4a')).toBe(true)
    expect(isElectronPlayable('webm')).toBe(false)
    expect(mimeForAudioKind('mp3')).toBe('audio/mpeg')
  })
})
