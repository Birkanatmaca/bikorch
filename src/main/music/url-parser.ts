import type { MusicSource } from '@shared/contracts/music'
import { MUSIC_AUDIO_EXTENSIONS } from '@shared/contracts/music'
import { extname } from 'path'

export type ParsedMusicLink = { source: 'youtube'; sourceId: string; sourceUrl: string }

export function parseMusicUrl(raw: string): ParsedMusicLink | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    const url = trimmed.startsWith('http') ? new URL(trimmed) : new URL(`https://${trimmed}`)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()

    if (host === 'youtu.be') {
      const id = url.pathname.replace(/^\//, '').split('/')[0]
      if (!id) return null
      return { source: 'youtube', sourceId: id, sourceUrl: `https://www.youtube.com/watch?v=${id}` }
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1]
      if (!id) return null
      return { source: 'youtube', sourceId: id, sourceUrl: `https://www.youtube.com/watch?v=${id}` }
    }
  } catch {
    return null
  }

  return null
}

/** Public HTTP(S) URL whose path ends with a supported audio extension. */
export function parseDirectAudioUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    const url = trimmed.startsWith('http') ? new URL(trimmed) : new URL(`https://${trimmed}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const ext = extname(url.pathname).toLowerCase()
    if (!MUSIC_AUDIO_EXTENSIONS.has(ext)) return null
    return url.toString()
  } catch {
    return null
  }
}

export function sourceLabel(source: MusicSource): string {
  if (source === 'youtube') return 'YouTube'
  return 'Local'
}
