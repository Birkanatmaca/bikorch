import { describe, expect, it } from 'vitest'
import { FFMPEG_WINDOWS_ZIP_URL, YTDLP_WINDOWS_URL } from '../official-urls'

describe('official engine URLs', () => {
  it('uses hardcoded official HTTPS endpoints', () => {
    expect(YTDLP_WINDOWS_URL).toBe('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe')
    expect(FFMPEG_WINDOWS_ZIP_URL).toBe('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip')
    expect(YTDLP_WINDOWS_URL.startsWith('https://')).toBe(true)
    expect(FFMPEG_WINDOWS_ZIP_URL.startsWith('https://')).toBe(true)
  })
})
