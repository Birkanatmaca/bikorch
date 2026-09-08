export type MusicSource = 'local' | 'youtube'
export type MusicStorageMode = 'reference' | 'managed'
export type RepeatMode = 'off' | 'one' | 'all'
export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

export interface MusicTrack {
  id: string
  title: string
  artist?: string
  album?: string
  durationMs?: number
  filePath?: string
  artworkPath?: string
  source: MusicSource
  sourceId?: string
  sourceUrl?: string
  isOfflineAvailable: boolean
  storageMode: MusicStorageMode
  addedAt: number
  lastPlayedAt?: number
  playCount: number
}

export interface MusicPlaylist {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface MusicPlaylistItem {
  playlistId: string
  trackId: string
  position: number
}

export interface MusicHistoryEntry {
  id: string
  trackId: string
  startedAt: number
  endedAt?: number
  listenedMs?: number
  source: MusicSource
  projectId?: string
}

export interface AddLinkResult {
  ok: boolean
  track?: MusicTrack
  duplicate?: boolean
  error?: string
}

export interface YouTubeSearchHit {
  videoId: string
  title: string
  channel?: string
  durationSec?: number
  thumbnailUrl?: string
  sourceUrl: string
}

export interface YouTubeSearchResult {
  ok: boolean
  items?: YouTubeSearchHit[]
  error?: string
}

export interface MusicSettings {
  keepListeningHistory: boolean
  associateWithProjects: boolean
  useInDeveloperInsights: boolean
  /** Default import mode for new files. */
  libraryMode: MusicStorageMode
  persistQueue: boolean
}

export interface MusicLibrarySummary {
  trackCount: number
  offlineCount: number
  offlineBytes: number
  favoriteCount: number
  playlistCount: number
}

export interface ImportTracksRequest {
  paths: string[]
  mode?: MusicStorageMode
}

export interface ImportTracksResult {
  imported: number
  skipped: number
  failed: number
  tracks: MusicTrack[]
  errors: string[]
}

export interface MusicPlaybackSnapshot {
  trackId: string | null
  positionMs: number
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  queueTrackIds: string[]
  updatedAt: number
}

export interface CreatePlaylistRequest {
  name: string
}

export interface RenamePlaylistRequest {
  id: string
  name: string
}

export interface PlaylistTracksRequest {
  playlistId: string
  trackIds: string[]
}

export interface ReorderPlaylistRequest {
  playlistId: string
  trackIds: string[]
}

export interface ReorderQueueRequest {
  trackIds: string[]
}

export interface RecordPlayRequest {
  trackId: string
  projectId?: string
}

export interface RecordListenRequest {
  historyId: string
  listenedMs: number
}

export interface UpdateTrackDurationRequest {
  trackId: string
  durationMs: number
}

export function createDefaultMusicSettings(): MusicSettings {
  return {
    keepListeningHistory: true,
    associateWithProjects: false,
    useInDeveloperInsights: false,
    libraryMode: 'reference',
    persistQueue: true
  }
}

export function trackPlaybackUrl(trackId: string): string {
  return `bikorch-music:///track/${encodeURIComponent(trackId)}`
}

export function trackArtworkUrl(trackId: string): string {
  return `bikorch-music:///art/${encodeURIComponent(trackId)}`
}

export function parseMusicResource(
  rawUrl: string
): { kind: 'track' | 'art'; id: string } | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'bikorch-music:') return null
    const host = decodeURIComponent(url.hostname || '')
    const path = decodeURIComponent(url.pathname || '')
    if (host === 'track' || host === 'art') {
      const id = path.replace(/^\//, '').split('/').filter(Boolean)[0]
      return id ? { kind: host, id } : null
    }
    const fromPath = path.match(/\/(track|art)\/([^/]+)/)
    if (!fromPath?.[1] || !fromPath[2]) return null
    return { kind: fromPath[1] as 'track' | 'art', id: fromPath[2] }
  } catch {
    return null
  }
}

export function parseTrackPlaybackId(rawUrl: string): string | null {
  const resource = parseMusicResource(rawUrl)
  return resource?.kind === 'track' ? resource.id : null
}

export const MUSIC_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.webm'
])

export const MUSIC_IPC = {
  LIBRARY_LIST: 'music:library:list',
  LIBRARY_IMPORT_FILES: 'music:library:import-files',
  LIBRARY_IMPORT_FOLDER: 'music:library:import-folder',
  LIBRARY_IMPORT_PATHS: 'music:library:import-paths',
  LIBRARY_REMOVE: 'music:library:remove',
  LIBRARY_UPDATE_DURATION: 'music:library:update-duration',
  LIBRARY_SUMMARY: 'music:library:summary',
  SEARCH: 'music:search',
  FAVORITES_LIST: 'music:favorites:list',
  FAVORITES_TOGGLE: 'music:favorites:toggle',
  HISTORY_LIST: 'music:history:list',
  HISTORY_RECORD_PLAY: 'music:history:record-play',
  HISTORY_RECORD_LISTEN: 'music:history:record-listen',
  PLAYLISTS_LIST: 'music:playlists:list',
  PLAYLISTS_CREATE: 'music:playlists:create',
  PLAYLISTS_RENAME: 'music:playlists:rename',
  PLAYLISTS_DELETE: 'music:playlists:delete',
  PLAYLISTS_ADD_TRACKS: 'music:playlists:add-tracks',
  PLAYLISTS_REMOVE_TRACK: 'music:playlists:remove-track',
  PLAYLISTS_REORDER: 'music:playlists:reorder',
  PLAYLISTS_GET_TRACKS: 'music:playlists:get-tracks',
  QUEUE_GET: 'music:queue:get',
  QUEUE_SET: 'music:queue:set',
  QUEUE_ADD: 'music:queue:add',
  QUEUE_REMOVE: 'music:queue:remove',
  QUEUE_CLEAR: 'music:queue:clear',
  QUEUE_REORDER: 'music:queue:reorder',
  GET_SETTINGS: 'music:get-settings',
  UPDATE_SETTINGS: 'music:update-settings',
  GET_PLAYBACK: 'music:get-playback',
  SAVE_PLAYBACK: 'music:save-playback',
  CHECK_TRACK: 'music:check-track',
  ENSURE_PLAYABLE: 'music:library:ensure-playable',
  LIBRARY_READ_PLAYBACK: 'music:library:read-playback',
  ADD_LINK: 'music:add-link',
  OPEN_EXTERNAL: 'music:open-external',
  YOUTUBE_SEARCH: 'music:youtube:search'
} as const
