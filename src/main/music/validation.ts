import type {
  CreatePlaylistRequest,
  ImportTracksRequest,
  MusicSettings,
  MusicStorageMode,
  MusicPlaybackSnapshot,
  RecordListenRequest,
  RecordPlayRequest,
  RenamePlaylistRequest,
  ReorderPlaylistRequest,
  ReorderQueueRequest,
  UpdateTrackDurationRequest
} from '@shared/contracts/music'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined
}

function requiredText(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

function stringList(value: unknown, max = 500): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 200)
    .slice(0, max)
}

export function parseImportPaths(payload: unknown): ImportTracksRequest | null {
  if (!isRecord(payload)) return null
  const paths = stringList(payload['paths'])
  if (paths.length === 0) return null
  const mode = payload['mode']
  return {
    paths,
    ...(mode === 'managed' || mode === 'reference' ? { mode } : {})
  }
}

export function parseStorageMode(value: unknown): MusicStorageMode | undefined {
  return value === 'managed' || value === 'reference' ? value : undefined
}

export function parseCreatePlaylist(payload: unknown): CreatePlaylistRequest | null {
  if (!isRecord(payload)) return null
  const name = requiredText(payload['name'], 120)
  if (!name) return null
  return { name }
}

export function parseRenamePlaylist(payload: unknown): RenamePlaylistRequest | null {
  if (!isRecord(payload)) return null
  const id = optionalId(payload['id'])
  const name = requiredText(payload['name'], 120)
  if (!id || !name) return null
  return { id, name }
}

export function parsePlaylistTracks(payload: unknown): { playlistId: string; trackIds: string[] } | null {
  if (!isRecord(payload)) return null
  const playlistId = optionalId(payload['playlistId'])
  const trackIds = stringList(payload['trackIds'])
  if (!playlistId || trackIds.length === 0) return null
  return { playlistId, trackIds }
}

export function parseReorderPlaylist(payload: unknown): ReorderPlaylistRequest | null {
  if (!isRecord(payload)) return null
  const playlistId = optionalId(payload['playlistId'])
  const trackIds = stringList(payload['trackIds'])
  if (!playlistId) return null
  return { playlistId, trackIds }
}

export function parseReorderQueue(payload: unknown): ReorderQueueRequest | null {
  if (!isRecord(payload)) return null
  const trackIds = stringList(payload['trackIds'])
  return { trackIds }
}

export function parseTrackId(payload: unknown): string | null {
  if (typeof payload === 'string') return optionalId(payload) ?? null
  if (isRecord(payload)) return optionalId(payload['trackId'] ?? payload['id']) ?? null
  return null
}

export function parseEnsurePlayable(payload: unknown): { trackId: string; force: boolean } | null {
  const trackId = parseTrackId(payload)
  if (!trackId) return null
  return { trackId, force: isRecord(payload) && payload['force'] === true }
}

export function parseSearchQuery(payload: unknown): string {
  if (typeof payload !== 'string') return ''
  return payload.trim().slice(0, 200)
}

export function parseRecordPlay(payload: unknown): RecordPlayRequest | null {
  if (!isRecord(payload)) return null
  const trackId = optionalId(payload['trackId'])
  if (!trackId) return null
  return {
    trackId,
    ...(optionalId(payload['projectId']) ? { projectId: optionalId(payload['projectId']) } : {})
  }
}

export function parseRecordListen(payload: unknown): RecordListenRequest | null {
  if (!isRecord(payload)) return null
  const historyId = optionalId(payload['historyId'])
  const listenedMs =
    typeof payload['listenedMs'] === 'number' && Number.isFinite(payload['listenedMs'])
      ? Math.max(0, Math.floor(payload['listenedMs']))
      : null
  if (!historyId || listenedMs === null) return null
  return { historyId, listenedMs }
}

export function parseUpdateDuration(payload: unknown): UpdateTrackDurationRequest | null {
  if (!isRecord(payload)) return null
  const trackId = optionalId(payload['trackId'])
  const durationMs =
    typeof payload['durationMs'] === 'number' && Number.isFinite(payload['durationMs'])
      ? Math.max(0, Math.floor(payload['durationMs']))
      : null
  if (!trackId || durationMs === null) return null
  return { trackId, durationMs }
}

export function parseSettingsUpdate(payload: unknown): Partial<MusicSettings> | null {
  if (!isRecord(payload)) return null
  const updates: Partial<MusicSettings> = {}
  if (typeof payload['keepListeningHistory'] === 'boolean') {
    updates.keepListeningHistory = payload['keepListeningHistory']
  }
  if (typeof payload['associateWithProjects'] === 'boolean') {
    updates.associateWithProjects = payload['associateWithProjects']
  }
  if (typeof payload['useInDeveloperInsights'] === 'boolean') {
    updates.useInDeveloperInsights = payload['useInDeveloperInsights']
  }
  if (payload['libraryMode'] === 'managed' || payload['libraryMode'] === 'reference') {
    updates.libraryMode = payload['libraryMode']
  }
  if (typeof payload['persistQueue'] === 'boolean') updates.persistQueue = payload['persistQueue']
  return updates
}

export function parseAddLink(payload: unknown): string | null {
  if (typeof payload !== 'string') return null
  const trimmed = payload.trim()
  if (!trimmed || trimmed.length > 4096) return null
  return trimmed
}

export function parseYouTubeSearchQuery(payload: unknown): string | null {
  const value = isRecord(payload) ? payload['query'] : payload
  if (typeof value !== 'string') return null
  const query = value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (query.length < 2 || query.length > 120) return null
  return query
}

export function parsePlaybackSnapshot(payload: unknown): MusicPlaybackSnapshot | null {
  if (!isRecord(payload)) return null
  const repeat =
    payload['repeat'] === 'one' || payload['repeat'] === 'all' ? payload['repeat'] : 'off'
  const volume =
    typeof payload['volume'] === 'number' && Number.isFinite(payload['volume'])
      ? Math.min(1, Math.max(0, payload['volume']))
      : 0.8
  const positionMs =
    typeof payload['positionMs'] === 'number' && Number.isFinite(payload['positionMs'])
      ? Math.max(0, payload['positionMs'])
      : 0
  return {
    trackId: optionalId(payload['trackId']) ?? null,
    positionMs,
    volume,
    shuffle: Boolean(payload['shuffle']),
    repeat,
    queueTrackIds: stringList(payload['queueTrackIds']),
    updatedAt: Date.now()
  }
}
