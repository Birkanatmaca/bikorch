import { describe, expect, it } from 'vitest'
import {
  FFMPEG_WINDOWS_ZIP_URL,
  YTDLP_LINUX_URL,
  YTDLP_MACOS_URL,
  YTDLP_WINDOWS_URL,
  ytDlpBinaryName,
  ytDlpOfficialUrl
} from '../official-urls'

describe('official engine URLs', () => {
  it('uses hardcoded official HTTPS endpoints', () => {
    expect(YTDLP_WINDOWS_URL).toBe('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe')
    expect(YTDLP_MACOS_URL).toBe('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos')
    expect(YTDLP_LINUX_URL).toBe('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp')
    expect(FFMPEG_WINDOWS_ZIP_URL).toBe('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip')
    expect(ytDlpOfficialUrl('darwin')).toBe(YTDLP_MACOS_URL)
    expect(ytDlpOfficialUrl('win32')).toBe(YTDLP_WINDOWS_URL)
    expect(ytDlpBinaryName('darwin')).toBe('yt-dlp')
    expect(ytDlpBinaryName('win32')).toBe('yt-dlp.exe')
  })
})
