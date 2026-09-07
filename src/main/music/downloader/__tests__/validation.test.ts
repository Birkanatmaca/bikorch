import { describe, expect, it } from 'vitest'
import {
  parseAnalyzeUrl,
  parseDownloadRequest,
  parseDownloadSettingsUpdate,
  parseJobId
} from '../validation'

describe('download IPC validation', () => {
  it('accepts a safe analyze URL and rejects local targets', () => {
    expect(parseAnalyzeUrl('https://media.example.com/watch?v=1')).toBe(
      'https://media.example.com/watch?v=1'
    )
    expect(parseAnalyzeUrl('http://127.0.0.1/secret')).toBeNull()
    expect(parseAnalyzeUrl({ sourceUrl: 'https://open.spotify.com/track/abc' })).toBeNull()
  })

  it('parses a complete download request', () => {
    expect(
      parseDownloadRequest({
        sourceUrl: 'https://example.com/a',
        mode: 'audio',
        formatId: 'convert:mp3:140',
        outputExt: 'mp3',
        isConversion: true,
        destinationId: 'default',
        importToLibrary: true,
        playlistId: 'pl-1'
      })
    ).toMatchObject({
      mode: 'audio',
      formatId: 'convert:mp3:140',
      outputExt: 'mp3',
      isConversion: true,
      importToLibrary: true,
      playlistId: 'pl-1'
    })
    expect(
      parseDownloadRequest({
        sourceUrl: 'https://example.com/a',
        mode: 'audio',
        formatId: 'ba/bestaudio/best',
        outputExt: 'm4a'
      })?.formatId
    ).toBe('ba/bestaudio/best')
    expect(parseDownloadRequest({ sourceUrl: 'https://example.com/a', mode: 'audio' })).toBeNull()
    expect(parseDownloadRequest({ sourceUrl: 'https://example.com/a', mode: 'audio', formatId: '140', outputExt: '../exe' })).toBeNull()
  })

  it('parses settings and job ids without accepting secrets', () => {
    expect(parseJobId('job-1')).toBe('job-1')
    expect(
      parseDownloadSettingsUpdate({
        maxConcurrentDownloads: 2,
        defaultAudioFormat: 'mp3',
        defaultAudioQuality: 'standard'
      })
    ).toEqual({
      maxConcurrentDownloads: 2,
      defaultAudioFormat: 'mp3',
      defaultAudioQuality: 'standard'
    })
    expect(parseDownloadSettingsUpdate({ defaultAudioFormat: 'wav' })).toEqual({})
    expect(parseDownloadSettingsUpdate({ maxConcurrentDownloads: 99 })).toEqual({})
  })
})
