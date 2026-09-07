import type {
  SpotifyCatalogTrack,
  SpotifyDevice,
  SpotifyPlaybackState,
  SpotifyTimeRange
} from '@shared/contracts/music'

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

export function mapSpotifyDevices(payload: unknown): SpotifyDevice[] {
  if (!isRecord(payload) || !Array.isArray(payload.devices)) return []
  return payload.devices.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()) return []
    return [
      {
        id: item.id,
        name: typeof item.name === 'string' && item.name.trim() ? item.name : 'Spotify device',
        type: typeof item.type === 'string' ? item.type : 'unknown',
        isActive: item.is_active === true,
        isRestricted: item.is_restricted === true,
        supportsVolume: item.supports_volume !== false
      }
    ]
  })
}

export function mapSpotifyPlaybackState(payload: unknown): SpotifyPlaybackState | null {
  if (payload == null) {
    return {
      trackId: null,
      deviceId: null,
      isPlaying: false,
      positionMs: 0,
      durationMs: 0,
      volume: null
    }
  }
  if (!isRecord(payload)) return null
  const item = isRecord(payload.item) ? payload.item : null
  const device = isRecord(payload.device) ? payload.device : null
  const artists = item && Array.isArray(item.artists)
    ? item.artists
        .filter((artist): artist is Record<string, unknown> => isRecord(artist))
        .map((artist) => (typeof artist.name === 'string' ? artist.name : ''))
        .filter(Boolean)
        .join(', ')
    : undefined
  return {
    trackId: item && typeof item.id === 'string' ? item.id : null,
    ...(item && typeof item.name === 'string' ? { title: item.name } : {}),
    ...(artists ? { artist: artists } : {}),
    deviceId: device && typeof device.id === 'string' ? device.id : null,
    ...(device && typeof device.name === 'string' ? { deviceName: device.name } : {}),
    isPlaying: payload.is_playing === true,
    positionMs:
      typeof payload.progress_ms === 'number' && Number.isFinite(payload.progress_ms)
        ? Math.max(0, payload.progress_ms)
        : 0,
    durationMs:
      item && typeof item.duration_ms === 'number' && Number.isFinite(item.duration_ms)
        ? Math.max(0, item.duration_ms)
        : 0,
    volume:
      device && typeof device.volume_percent === 'number' && Number.isFinite(device.volume_percent)
        ? Math.min(100, Math.max(0, device.volume_percent))
        : null
  }
}
