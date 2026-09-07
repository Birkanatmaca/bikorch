import { basename, extname } from 'path'

/** Parse "Artist - Title" or use filename stem as title. */
export function metadataFromFilename(filePath: string): { title: string; artist?: string } {
  const stem = basename(filePath, extname(filePath)).trim()
  if (!stem) return { title: 'Untitled track' }

  const dashSplit = stem.match(/^(.+?)\s[-–—]\s(.+)$/)
  if (dashSplit) {
    const artist = dashSplit[1]?.trim()
    const title = dashSplit[2]?.trim()
    if (artist && title) return { title, artist }
  }

  return { title: stem }
}

export function isAudioExtension(ext: string): boolean {
  return ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.webm'].includes(ext.toLowerCase())
}
