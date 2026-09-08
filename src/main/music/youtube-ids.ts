import type { YouTubeSearchHit } from '@shared/contracts/music'

export type { YouTubeSearchHit }

export function isYouTubeVideoId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(value)
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fromUrl(value: string): string | null {
  if (isYouTubeVideoId(value)) return value
  const match = value.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/)
  return match && isYouTubeVideoId(match[1]) ? match[1] : null
}

export function extractYouTubeVideoId(raw: unknown): string | null {
  if (typeof raw === 'string') return fromUrl(raw.trim())
  if (!isRecord(raw)) return null
  if (typeof raw.id === 'string') {
    const id = fromUrl(raw.id)
    if (id) return id
  }
  if (Array.isArray(raw.entries)) {
    for (const entry of raw.entries) {
      const nested = extractYouTubeVideoId(entry)
      if (nested) return nested
    }
  }
  for (const key of ['webpage_url', 'original_url', 'url']) {
    const nested = extractYouTubeVideoId(raw[key])
    if (nested) return nested
  }
  return null
}

function thumbnailFromRaw(videoId: string, raw: Record<string, unknown>): string {
  if (typeof raw.thumbnail === 'string' && raw.thumbnail.startsWith('https://')) return raw.thumbnail
  if (Array.isArray(raw.thumbnails)) {
    const urls = raw.thumbnails
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => (typeof item.url === 'string' ? item.url : ''))
      .filter((url) => url.startsWith('https://'))
    const last = urls[urls.length - 1]
    if (last) return last
  }
  return youtubeThumbnailUrl(videoId)
}

export function mapYouTubeSearchHit(raw: unknown): YouTubeSearchHit | null {
  const videoId = extractYouTubeVideoId(raw)
  if (!videoId) return null
  const record = isRecord(raw) ? raw : {}
  const title =
    typeof record.title === 'string' && record.title.trim() ? record.title.trim().slice(0, 200) : `YouTube ${videoId}`
  const channel =
    (typeof record.uploader === 'string' && record.uploader.trim()) ||
    (typeof record.channel === 'string' && record.channel.trim()) ||
    (typeof record.artist === 'string' && record.artist.trim()) ||
    undefined
  const durationSec =
    typeof record.duration === 'number' && Number.isFinite(record.duration) && record.duration > 0
      ? Math.round(record.duration)
      : undefined
  return {
    videoId,
    title,
    ...(channel ? { channel: channel.slice(0, 120) } : {}),
    ...(durationSec ? { durationSec } : {}),
    thumbnailUrl: thumbnailFromRaw(videoId, record),
    sourceUrl: youtubeWatchUrl(videoId)
  }
}

export function extractYouTubeSearchHits(raw: unknown, limit = 3): YouTubeSearchHit[] {
  const cap = Math.min(12, Math.max(1, limit))
  const hits: YouTubeSearchHit[] = []
  const seen = new Set<string>()
  const add = (item: unknown): void => {
    const hit = mapYouTubeSearchHit(item)
    if (!hit || seen.has(hit.videoId) || hits.length >= cap) return
    seen.add(hit.videoId)
    hits.push(hit)
  }
  if (Array.isArray(raw)) {
    for (const item of raw) add(item)
  } else if (isRecord(raw) && Array.isArray(raw.entries)) {
    for (const item of raw.entries) add(item)
  } else {
    add(raw)
  }
  return hits
}

export function sanitizeYouTubeSearchQuery(raw: string): string | null {
  const query = raw
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return query.length >= 2 ? query : null
}
