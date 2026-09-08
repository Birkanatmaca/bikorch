import type { MusicTrack } from '@shared/contracts/music'

export function uniqueRecentlyPlayed(tracks: MusicTrack[], limit = 30): MusicTrack[] {
  const seen = new Set<string>()
  const result: MusicTrack[] = []
  const sorted = [...tracks]
    .filter((track) => typeof track.lastPlayedAt === 'number')
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))

  for (const track of sorted) {
    const key = track.sourceId ? `${track.source}:${track.sourceId}` : track.id
    if (seen.has(key) || seen.has(track.id)) continue
    seen.add(key)
    seen.add(track.id)
    result.push(track)
    if (result.length >= limit) break
  }
  return result
}
