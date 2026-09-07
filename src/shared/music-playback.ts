import type { MusicTrack } from './contracts/music'

export type SpotifyPlayRoute =
  | { kind: 'local'; trackId: string }
  | { kind: 'connect'; sourceId: string }
  | { kind: 'unavailable'; reason: string }

/** Decide how a Spotify library item should play. Never routes to YouTube. */
export function resolveSpotifyPlayRoute(
  track: Pick<MusicTrack, 'id' | 'source' | 'sourceId' | 'filePath' | 'isOfflineAvailable'>
): SpotifyPlayRoute {
  if (track.source !== 'spotify') {
    return { kind: 'unavailable', reason: 'Not a Spotify track' }
  }
  if (track.isOfflineAvailable && track.filePath) {
    return { kind: 'local', trackId: track.id }
  }
  if (track.sourceId && track.sourceId.trim()) {
    return { kind: 'connect', sourceId: track.sourceId.trim() }
  }
  return { kind: 'unavailable', reason: 'This Spotify reference has no track id' }
}

export function spotifyTrackUri(sourceId: string): string {
  return `spotify:track:${sourceId}`
}

export function spotifyWebTrackUrl(sourceId: string): string {
  return `https://open.spotify.com/track/${encodeURIComponent(sourceId)}`
}
