import { randomUUID } from 'crypto'
import type { AddLinkResult, MusicTrack } from '@shared/contracts/music'
import { fetchLinkMetadata } from './link-metadata'
import { parseMusicUrl } from './url-parser'
import { getMusicStore } from './store'

export async function addStreamingLink(url: string): Promise<AddLinkResult> {
  const parsed = parseMusicUrl(url)
  if (!parsed) {
    return {
      ok: false,
      error: 'Unsupported streaming link. Use a YouTube or Spotify track URL.'
    }
  }

  const store = getMusicStore()
  if (!store) return { ok: false, error: 'Database is not ready' }

  const existing = store.findBySource(parsed.source, parsed.sourceId)
  if (existing) {
    return { ok: true, track: existing, duplicate: true }
  }

  const meta = await fetchLinkMetadata(parsed.sourceUrl)
  const track: MusicTrack = {
    id: randomUUID(),
    title: meta.title,
    ...(meta.artist ? { artist: meta.artist } : {}),
    source: parsed.source,
    sourceId: parsed.sourceId,
    sourceUrl: parsed.sourceUrl,
    isOfflineAvailable: false,
    storageMode: 'reference',
    addedAt: Date.now(),
    playCount: 0,
    ...(meta.artworkUrl ? { artworkPath: meta.artworkUrl } : {})
  }

  store.upsertTrack(track, null)
  return { ok: true, track, duplicate: false }
}
