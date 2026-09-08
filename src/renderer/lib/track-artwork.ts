import { trackArtworkUrl } from '@shared/contracts/music'
import type { MusicTrack } from '@shared/contracts/music'

export function trackCoverUrl(
  track: Pick<MusicTrack, 'id' | 'artworkPath' | 'source' | 'sourceId'> | null
): string | null {
  if (!track) return null
  if (track.artworkPath && /^https:\/\//i.test(track.artworkPath)) return track.artworkPath
  if (track.artworkPath && !/^https?:\/\//i.test(track.artworkPath)) {
    return `${trackArtworkUrl(track.id)}?v=${encodeURIComponent(track.artworkPath)}`
  }
  if (track.source === 'youtube' && track.sourceId) {
    return `https://i.ytimg.com/vi/${track.sourceId}/hqdefault.jpg`
  }
  return null
}
