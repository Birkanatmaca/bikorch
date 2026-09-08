export const YTDLP_WINDOWS_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
export const YTDLP_MACOS_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
export const YTDLP_LINUX_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
export const FFMPEG_WINDOWS_ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'

export function ytDlpOfficialUrl(platform = process.platform): string {
  if (platform === 'win32') return YTDLP_WINDOWS_URL
  if (platform === 'darwin') return YTDLP_MACOS_URL
  return YTDLP_LINUX_URL
}

export function ytDlpBinaryName(platform = process.platform): string {
  return platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
}
