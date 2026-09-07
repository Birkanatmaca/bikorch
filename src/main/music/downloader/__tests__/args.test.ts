import { describe, expect, it } from 'vitest'
import { buildAnalyzeArgs, buildDownloadArgs, canTransitionStatus, parseDownloadProgress } from '../args'

describe('safe argument construction', () => {
  it('places the URL after -- and never uses a shell string', () => {
    const args = buildAnalyzeArgs({ url: 'https://example.com/watch?v=1' })
    expect(args[args.length - 2]).toBe('--')
    expect(args[args.length - 1]).toBe('https://example.com/watch?v=1')
    expect(args.join(' ')).not.toContain('https://example.com/watch?v=1 --')
  })

  it('keeps conversion flags as discrete argv tokens', () => {
    const args = buildDownloadArgs({
      url: 'https://cdn.example.com/a.mp4',
      mode: 'audio',
      formatId: 'convert:mp3:140',
      outputTemplate: '/tmp/out.%(ext)s',
      isConversion: true,
      outputExt: 'mp3',
      ffmpegPath: '/usr/bin/ffmpeg'
    })
    expect(args).toContain('-f')
    expect(args).toContain('140')
    expect(args).toContain('--audio-format')
    expect(args).toContain('mp3')
    expect(args).toContain('--audio-quality')
    expect(args).toContain('0')
    expect(args).toContain('--add-metadata')
    expect(args).toContain('--write-thumbnail')
    expect(args).toContain('--ffmpeg-location')
    expect(args.at(-1)).toBe('https://cdn.example.com/a.mp4')
    expect(args.some((token) => token.includes('convert:'))).toBe(false)
  })

  it('uses standard audio quality when requested', () => {
    const args = buildDownloadArgs({
      url: 'https://cdn.example.com/a.mp4',
      mode: 'audio',
      formatId: 'ba/bestaudio/best',
      outputTemplate: '/tmp/out.%(ext)s',
      isConversion: true,
      outputExt: 'm4a',
      audioQuality: '5'
    })
    expect(args).toContain('--audio-quality')
    expect(args).toContain('5')
    expect(args).toContain('m4a')
  })

  it('rejects conversion to an unknown container', () => {
    expect(() =>
      buildDownloadArgs({
        url: 'https://example.com/a',
        mode: 'audio',
        formatId: '140',
        outputTemplate: '/tmp/a.%(ext)s',
        isConversion: true,
        outputExt: 'exe'
      })
    ).toThrow(/Unsupported conversion/)
  })
})

describe('progress parsing', () => {
  it('reads percent, speed and eta from yt-dlp newline output', () => {
    const parsed = parseDownloadProgress('[download]  45.2% of 10.00MiB at  2.00MiB/s ETA 00:18')
    expect(parsed?.percent).toBeCloseTo(45.2)
    expect(parsed?.speedBytesPerSec).toBeGreaterThan(1_000_000)
    expect(parsed?.etaSec).toBe(18)
  })
})

describe('job state transitions', () => {
  it('allows the documented download lifecycle', () => {
    expect(canTransitionStatus('pending', 'downloading')).toBe(true)
    expect(canTransitionStatus('downloading', 'processing')).toBe(true)
    expect(canTransitionStatus('processing', 'completed')).toBe(true)
    expect(canTransitionStatus('failed', 'pending')).toBe(true)
    expect(canTransitionStatus('completed', 'pending')).toBe(false)
    expect(canTransitionStatus('completed', 'failed')).toBe(false)
  })
})
