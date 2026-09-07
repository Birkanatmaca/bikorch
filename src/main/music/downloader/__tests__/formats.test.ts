import { describe, expect, it } from 'vitest'
import { BEST_AUDIO_SELECTOR, buildMediaAnalysis, parseYtdlpInfo, preferredFormatId, resolveSelectedFormat } from '../formats'

const fixture = {
  title: 'Demo Track',
  uploader: 'Studio',
  duration: 125,
  extractor_key: 'Generic',
  thumbnail: 'https://cdn.example.com/art.jpg',
  formats: [
    { format_id: '140', ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', abr: 128, filesize: 2_000_000 },
    { format_id: '251', ext: 'webm', acodec: 'opus', vcodec: 'none', abr: 160, filesize: 2_400_000 },
    { format_id: '18', ext: 'mp4', acodec: 'mp4a.40.2', vcodec: 'avc1', height: 360, filesize: 8_000_000 },
    { format_id: '22', ext: 'mp4', acodec: 'mp4a.40.2', vcodec: 'avc1', height: 720, filesize: 20_000_000 },
    { format_id: 'sb0', ext: 'mhtml', protocol: 'mhtml', format_note: 'storyboard' }
  ]
}

describe('format selection', () => {
  it('requires playable MP3 when FFmpeg exists and hides WebM', () => {
    const info = parseYtdlpInfo(fixture)
    expect(info).not.toBeNull()
    const analysis = buildMediaAnalysis(info!, 'https://example.com/a', true)
    expect('error' in analysis).toBe(false)
    if ('error' in analysis) return
    expect(analysis.title).toBe('Demo Track')
    expect(analysis.audioFormats).toHaveLength(1)
    expect(analysis.audioFormats[0]).toMatchObject({
      id: BEST_AUDIO_SELECTOR,
      ext: 'mp3',
      isConversion: true
    })
    expect(analysis.audioFormats.some((item) => item.id === '251')).toBe(false)
    expect(analysis.videoFormats.some((item) => item.resolution === '720p')).toBe(true)
    expect(analysis.audioFormats.some((item) => item.id === 'sb0')).toBe(false)
  })

  it('only lists already-playable audio when FFmpeg is missing', () => {
    const analysis = buildMediaAnalysis(parseYtdlpInfo(fixture)!, 'https://example.com/a', false)
    if ('error' in analysis) throw new Error(analysis.error)
    expect(analysis.audioFormats.every((item) => item.ext === 'm4a')).toBe(true)
    expect(analysis.audioFormats.every((item) => !item.isConversion)).toBe(true)
    expect(analysis.videoFormats.every((item) => item.id !== 'bv*+ba/b')).toBe(true)
  })

  it('rejects playlist payloads and selects preferred formats', () => {
    expect(buildMediaAnalysis({ _type: 'playlist', formats: [] }, 'https://example.com/list', true)).toEqual({
      error: 'Playlists are not supported. Paste a single media URL.'
    })
    const analysis = buildMediaAnalysis(parseYtdlpInfo(fixture)!, 'https://example.com/a', true)
    if ('error' in analysis) throw new Error(analysis.error)
    const audio = preferredFormatId(analysis, 'audio', 'm4a', 'best')
    expect(audio).toBe(BEST_AUDIO_SELECTOR)
    expect(resolveSelectedFormat(analysis, 'audio', audio!)?.ext).toBe('mp3')
    expect(preferredFormatId(analysis, 'video', 'm4a', '720')).toBe('22')
  })
})
