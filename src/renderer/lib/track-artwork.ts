import { trackArtworkUrl } from '@shared/contracts/music'
import type { MusicTrack } from '@shared/contracts/music'

export function trackCoverUrl(track: Pick<MusicTrack, 'id' | 'artworkPath' | 'source'> | null): string | null {
  if (!track) return null
  if (track.artworkPath && /^https:\/\//i.test(track.artworkPath)) return track.artworkPath
  if (track.artworkPath || track.source === 'youtube' || track.source === 'spotify') {
    const stamp = track.artworkPath ? encodeURIComponent(track.artworkPath) : 'pending'
    return `${trackArtworkUrl(track.id)}?v=${stamp}`
  }
  return null
}
