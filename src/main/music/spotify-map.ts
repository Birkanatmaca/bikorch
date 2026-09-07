import type { SpotifyCatalogTrack, SpotifyTimeRange } from '@shared/contracts/music'

export function isSpotifyTrackId(value: string): boolean {
  return /^[A-Za-z0-9]{16,32}$/.test(value)
}

export function isSpotifyTimeRange(value: unknown): value is SpotifyTimeRange {
  return value === 'short_term' || value === 'medium_term' || value === 'long_term'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function bestArtworkUrl(images: unknown): string | undefined {
  if (!Array.isArray(images)) return undefined
  const urls = images
    .map((item) => {
      if (!isRecord(item) || typeof item['url'] !== 'string') return null
      const url = item['url'].trim()
      if (!url.startsWith('https://')) return null
      const width = typeof item['width'] === 'number' ? item['width'] : 0
      return { url, width }
    })
    .filter((item): item is { url: string; width: number } => Boolean(item))
    .sort((left, right) => right.width - left.width)
  return urls[0]?.url
}

export function mapSpotifyApiTrack(raw: unknown): SpotifyCatalogTrack | null {
  if (!isRecord(raw)) return null
  const sourceId = typeof raw['id'] === 'string' ? raw['id'] : ''
  const title = typeof raw['name'] === 'string' ? raw['name'].trim() : ''
  if (!isSpotifyTrackId(sourceId) || !title) return null
  const artists = Array.isArray(raw['artists'])
    ? raw['artists']
        .map((artist) => (isRecord(artist) && typeof artist['name'] === 'string' ? artist['name'].trim() : ''))
        .filter(Boolean)
    : []
  const album = isRecord(raw['album']) ? raw['album'] : null
  const durationMs = typeof raw['duration_ms'] === 'number' ? Math.max(0, Math.round(raw['duration_ms'])) : 0
  const artworkUrl = bestArtworkUrl(album?.['images'])
  return {
    sourceId,
    title,
    artist: artists.join(', ') || 'Unknown artist',
    durationMs,
    sourceUrl: `https://open.spotify.com/track/${sourceId}`,
    ...(artworkUrl ? { artworkUrl } : {})
  }
}
