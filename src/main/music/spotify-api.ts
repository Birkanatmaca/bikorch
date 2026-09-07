import { randomUUID } from 'crypto'
import type { MusicTrack, SpotifyCatalogTrack, SpotifyTimeRange } from '@shared/contracts/music'
import { downloadRemoteArtwork } from './artwork'
import { mapSpotifyApiTrack, isSpotifyTrackId } from './spotify-map'
import { spotifyRequest } from './spotify-client'
import { formatSpotifyError } from './spotify-errors'
import { getMusicStore } from './store'

export { isSpotifyTimeRange, isSpotifyTrackId, mapSpotifyApiTrack } from './spotify-map'

async function spotifyGet<T>(path: string): Promise<T> {
  const result = await spotifyRequest({ method: 'GET', path })
  if (!result.ok) throw new Error(formatSpotifyError(result.error))
  return (result.json ?? {}) as T
}

function markLibraryState(items: SpotifyCatalogTrack[]): SpotifyCatalogTrack[] {
  const store = getMusicStore()
  return items.map((item) => ({
    ...item,
    alreadyInLibrary: Boolean(store?.findBySource('spotify', item.sourceId))
  }))
}

export async function listSpotifyTopTracks(
  timeRange: SpotifyTimeRange = 'long_term',
  limit = 5
): Promise<SpotifyCatalogTrack[]> {
  const safeLimit = Math.min(50, Math.max(1, Math.round(limit)))
  const payload = await spotifyGet<{ items?: unknown[] }>(
    `/v1/me/top/tracks?time_range=${timeRange}&limit=${safeLimit}`
  )
  const items = (payload.items ?? [])
    .map(mapSpotifyApiTrack)
    .filter((item): item is SpotifyCatalogTrack => Boolean(item))
  return markLibraryState(items)
}

export async function importSpotifyCatalogTracks(
  items: SpotifyCatalogTrack[]
): Promise<{ imported: number; skipped: number; tracks: MusicTrack[] }> {
  const store = getMusicStore()
  if (!store) throw new Error('Database is not ready')
  let imported = 0
  let skipped = 0
  const tracks: MusicTrack[] = []

  for (const item of items) {
    const existing = store.findBySource('spotify', item.sourceId)
    if (existing) {
      skipped += 1
      tracks.push(existing)
      continue
    }
    const track: MusicTrack = {
      id: randomUUID(),
      title: item.title,
      artist: item.artist,
      ...(item.durationMs ? { durationMs: item.durationMs } : {}),
      source: 'spotify',
      sourceId: item.sourceId,
      sourceUrl: item.sourceUrl,
      isOfflineAvailable: false,
      storageMode: 'reference',
      addedAt: Date.now(),
      playCount: 0,
      ...(item.artworkUrl ? { artworkPath: item.artworkUrl } : {})
    }
    store.upsertTrack(track, null)
    if (item.artworkUrl) {
      const localArt = await downloadRemoteArtwork(track.id, [item.artworkUrl]).catch(() => null)
      if (localArt) store.updateTrackArtwork(track.id, localArt)
    }
    imported += 1
    tracks.push(store.getTrack(track.id) ?? track)
  }

  return { imported, skipped, tracks }
}

export async function importSpotifyTopTracks(
  timeRange: SpotifyTimeRange = 'long_term',
  limit = 5
): Promise<{ imported: number; skipped: number; tracks: MusicTrack[] }> {
  const items = await listSpotifyTopTracks(timeRange, limit)
  return importSpotifyCatalogTracks(items)
}

export async function importSpotifyTrackById(
  sourceId: string
): Promise<{ ok: true; track: MusicTrack; duplicate: boolean } | { ok: false; error: string }> {
  if (!isSpotifyTrackId(sourceId)) return { ok: false, error: 'Invalid Spotify track' }
  const store = getMusicStore()
  if (!store) return { ok: false, error: 'Database is not ready' }
  const existing = store.findBySource('spotify', sourceId)
  if (existing) return { ok: true, track: existing, duplicate: true }
  try {
    const raw = await spotifyGet<unknown>(`/v1/tracks/${encodeURIComponent(sourceId)}`)
    const mapped = mapSpotifyApiTrack(raw)
    if (!mapped) return { ok: false, error: 'Spotify did not return a playable track' }
    const result = await importSpotifyCatalogTracks([mapped])
    const track = result.tracks[0]
    if (!track) return { ok: false, error: 'Could not add this Spotify track' }
    return { ok: true, track, duplicate: false }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Spotify request failed' }
  }
}
