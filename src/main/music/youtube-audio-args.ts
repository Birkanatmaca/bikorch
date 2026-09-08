export function buildYouTubeAudioUrlArgs(sourceUrl: string, fast = true): string[] {
  if (!sourceUrl || sourceUrl.includes('\0')) throw new Error('Invalid YouTube URL')
  const args = [
    '-f',
    '140/bestaudio[ext=m4a]/bestaudio/best',
    '-g',
    '--no-playlist',
    '--no-warnings',
    '--ignore-config',
    '--no-cache-dir',
    '--no-call-home',
    '--socket-timeout',
    '12'
  ]
  if (fast) {
    args.push('--extractor-args', 'youtube:player_client=android,web')
  }
  args.push('--', sourceUrl)
  return args
}
