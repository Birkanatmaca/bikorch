import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { findSidecarThumbnail, sniffImageKind, youtubeArtworkUrls } from '../artwork'

describe('youtube artwork urls', () => {
  it('builds public thumbnail candidates for a video id', () => {
    const urls = youtubeArtworkUrls('dQw4w9WgXcQ')
    expect(urls[0]).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg')
    expect(urls).toHaveLength(3)
  })

  it('rejects values that are not YouTube video ids', () => {
    expect(youtubeArtworkUrls('short')).toEqual([])
    expect(youtubeArtworkUrls('')).toEqual([])
  })
})

describe('image sniffing', () => {
  it('detects jpeg, png and webp headers', () => {
    expect(sniffImageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(sniffImageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png')
    const webp = Buffer.from('RIFF....WEBP', 'ascii')
    webp[4] = 0
    webp[5] = 0
    webp[6] = 0
    webp[7] = 0
    expect(sniffImageKind(webp)).toBe('webp')
    expect(sniffImageKind(Buffer.from('ID3'))).toBeNull()
  })
})

describe('sidecar thumbnails', () => {
  it('finds an image next to the downloaded audio file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bikorch-art-'))
    const audio = join(dir, 'clip.mp3')
    const thumb = join(dir, 'clip.webp')
    writeFileSync(audio, 'x')
    writeFileSync(thumb, 'y')
    expect(findSidecarThumbnail(audio)).toBe(thumb)
  })
})
