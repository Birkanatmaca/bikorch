import type { Database } from 'sql.js'
import { getPersistenceDatabase, schedulePersistToDisk } from '../persistence/database'
import type {
  MusicHistoryEntry,
  MusicPlaybackSnapshot,
  MusicPlaylist,
  MusicPlaylistItem,
  MusicSettings,
  MusicSource,
  MusicStorageMode,
  MusicTrack,
  RepeatMode
} from '@shared/contracts/music'
import { createDefaultMusicSettings } from '@shared/contracts/music'

type Row = Record<string, unknown>

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : undefined
}

function bool(value: unknown, fallback: boolean): boolean {
  return value === 1 || value === true ? true : value === 0 || value === false ? false : fallback
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function rowToTrack(row: Row): MusicTrack | null {
  const id = text(row['id'])
  const title = text(row['title'])
  const source = text(row['source']) as MusicSource | undefined
  const addedAt = integer(row['added_at'])
  if (!id || !title || !source || addedAt === undefined) return null
  return {
    id,
    title,
    ...(text(row['artist']) ? { artist: text(row['artist']) } : {}),
    ...(text(row['album']) ? { album: text(row['album']) } : {}),
    ...(integer(row['duration_ms']) !== undefined ? { durationMs: integer(row['duration_ms']) } : {}),
    ...(text(row['file_path']) ? { filePath: text(row['file_path']) } : {}),
    ...(text(row['artwork_path']) ? { artworkPath: text(row['artwork_path']) } : {}),
    source,
    ...(text(row['source_id']) ? { sourceId: text(row['source_id']) } : {}),
    ...(text(row['source_url']) ? { sourceUrl: text(row['source_url']) } : {}),
    isOfflineAvailable: bool(row['is_offline_available'], true),
    storageMode: text(row['storage_mode']) === 'managed' ? 'managed' : 'reference',
    addedAt,
    ...(integer(row['last_played_at']) !== undefined ? { lastPlayedAt: integer(row['last_played_at']) } : {}),
    playCount: integer(row['play_count']) ?? 0
  }
}

export function initMusicSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS music_tracks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      duration_ms INTEGER,
      file_path TEXT,
      artwork_path TEXT,
      source TEXT NOT NULL,
      source_id TEXT,
      source_url TEXT,
      is_offline_available INTEGER NOT NULL DEFAULT 1,
      storage_mode TEXT NOT NULL DEFAULT 'reference',
      added_at INTEGER NOT NULL,
      last_played_at INTEGER,
      play_count INTEGER NOT NULL DEFAULT 0,
      canonical_path TEXT
    );
  `)
  db.run('CREATE INDEX IF NOT EXISTS music_tracks_added_at ON music_tracks (added_at);')
  db.run('CREATE INDEX IF NOT EXISTS music_tracks_canonical ON music_tracks (canonical_path);')
  db.run(`
    CREATE TABLE IF NOT EXISTS music_playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS music_playlist_items (
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id)
    );
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS music_favorites (
      track_id TEXT PRIMARY KEY,
      added_at INTEGER NOT NULL
    );
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS music_queue (
      position INTEGER PRIMARY KEY,
      track_id TEXT NOT NULL
    );
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS music_history (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      listened_ms INTEGER,
      source TEXT NOT NULL,
      project_id TEXT
    );
  `)
  db.run('CREATE INDEX IF NOT EXISTS music_history_started ON music_history (started_at);')
}

export class MusicStore {
  constructor(private readonly db: Database) {}

  listTracks(): MusicTrack[] {
    const result = this.db.exec('SELECT * FROM music_tracks ORDER BY added_at DESC')
    if (result.length === 0) return []
    const columns = result[0].columns
    return result[0].values
      .map((values) => {
        const row: Row = {}
        columns.forEach((column, index) => {
          row[column] = values[index]
        })
        return rowToTrack(row)
      })
      .filter((track): track is MusicTrack => Boolean(track))
  }

  getTrack(id: string): MusicTrack | null {
    const stmt = this.db.prepare('SELECT * FROM music_tracks WHERE id = ?')
    stmt.bind([id])
    if (!stmt.step()) {
      stmt.free()
      return null
    }
    const row = stmt.getAsObject() as Row
    stmt.free()
    return rowToTrack(row)
  }

  findByCanonicalPath(path: string): MusicTrack | null {
    const stmt = this.db.prepare('SELECT * FROM music_tracks WHERE canonical_path = ? LIMIT 1')
    stmt.bind([path])
    if (!stmt.step()) {
      stmt.free()
      return null
    }
    const row = stmt.getAsObject() as Row
    stmt.free()
    return rowToTrack(row)
  }

  findBySource(source: string, sourceId: string): MusicTrack | null {
    const stmt = this.db.prepare('SELECT * FROM music_tracks WHERE source = ? AND source_id = ? LIMIT 1')
    stmt.bind([source, sourceId])
    if (!stmt.step()) {
      stmt.free()
      return null
    }
    const row = stmt.getAsObject() as Row
    stmt.free()
    return rowToTrack(row)
  }

  upsertTrack(track: MusicTrack, canonicalPath: string | null): void {
    this.db.run(
      `INSERT OR REPLACE INTO music_tracks (
        id, title, artist, album, duration_ms, file_path, artwork_path, source, source_id, source_url,
        is_offline_available, storage_mode, added_at, last_played_at, play_count, canonical_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        track.id,
        track.title,
        track.artist ?? null,
        track.album ?? null,
        track.durationMs ?? null,
        track.filePath ?? null,
        track.artworkPath ?? null,
        track.source,
        track.sourceId ?? null,
        track.sourceUrl ?? null,
        track.isOfflineAvailable ? 1 : 0,
        track.storageMode,
        track.addedAt,
        track.lastPlayedAt ?? null,
        track.playCount,
        canonicalPath
      ]
    )
    schedulePersistToDisk()
  }

  updateTrackArtwork(id: string, artworkPath: string): void {
    this.db.run('UPDATE music_tracks SET artwork_path = ? WHERE id = ?', [artworkPath, id])
    schedulePersistToDisk()
  }

  updateTrackDuration(id: string, durationMs: number): void {
    this.db.run('UPDATE music_tracks SET duration_ms = ? WHERE id = ?', [durationMs, id])
    schedulePersistToDisk()
  }

  markPlayed(id: string, at: number): void {
    this.db.run(
      'UPDATE music_tracks SET last_played_at = ?, play_count = play_count + 1 WHERE id = ?',
      [at, id]
    )
    schedulePersistToDisk()
  }

  removeTrack(id: string): boolean {
    this.db.run('DELETE FROM music_tracks WHERE id = ?', [id])
    this.db.run('DELETE FROM music_favorites WHERE track_id = ?', [id])
    this.db.run('DELETE FROM music_playlist_items WHERE track_id = ?', [id])
    this.db.run('DELETE FROM music_queue WHERE track_id = ?', [id])
    schedulePersistToDisk()
    return true
  }

  searchTracks(query: string): MusicTrack[] {
    const needle = `%${query.toLowerCase()}%`
    const stmt = this.db.prepare(
      `SELECT * FROM music_tracks
       WHERE lower(title) LIKE ? OR lower(COALESCE(artist, '')) LIKE ? OR lower(COALESCE(album, '')) LIKE ?
       ORDER BY added_at DESC`
    )
    stmt.bind([needle, needle, needle])
    const tracks: MusicTrack[] = []
    while (stmt.step()) {
      const track = rowToTrack(stmt.getAsObject() as Row)
      if (track) tracks.push(track)
    }
    stmt.free()
    return tracks
  }

  listFavorites(): string[] {
    const result = this.db.exec('SELECT track_id FROM music_favorites ORDER BY added_at DESC')
    if (result.length === 0) return []
    return result[0].values.map((row) => String(row[0]))
  }

  toggleFavorite(trackId: string): boolean {
    const existing = this.db.exec('SELECT track_id FROM music_favorites WHERE track_id = ?', [trackId])
    if (existing.length > 0 && existing[0].values.length > 0) {
      this.db.run('DELETE FROM music_favorites WHERE track_id = ?', [trackId])
      schedulePersistToDisk()
      return false
    }
    this.db.run('INSERT OR REPLACE INTO music_favorites (track_id, added_at) VALUES (?, ?)', [
      trackId,
      Date.now()
    ])
    schedulePersistToDisk()
    return true
  }

  listPlaylists(): MusicPlaylist[] {
    const result = this.db.exec('SELECT * FROM music_playlists ORDER BY updated_at DESC')
    if (result.length === 0) return []
    const columns = result[0].columns
    return result[0].values.map((values) => {
      const row: Row = {}
      columns.forEach((column, index) => {
        row[column] = values[index]
      })
      return {
        id: String(row['id']),
        name: String(row['name']),
        createdAt: integer(row['created_at']) ?? 0,
        updatedAt: integer(row['updated_at']) ?? 0
      }
    })
  }

  createPlaylist(playlist: MusicPlaylist): void {
    this.db.run(
      'INSERT INTO music_playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [playlist.id, playlist.name, playlist.createdAt, playlist.updatedAt]
    )
    schedulePersistToDisk()
  }

  renamePlaylist(id: string, name: string, updatedAt: number): void {
    this.db.run('UPDATE music_playlists SET name = ?, updated_at = ? WHERE id = ?', [name, updatedAt, id])
    schedulePersistToDisk()
  }

  deletePlaylist(id: string): void {
    this.db.run('DELETE FROM music_playlists WHERE id = ?', [id])
    this.db.run('DELETE FROM music_playlist_items WHERE playlist_id = ?', [id])
    schedulePersistToDisk()
  }

  getPlaylistTracks(playlistId: string): MusicTrack[] {
    const stmt = this.db.prepare(
      `SELECT t.* FROM music_playlist_items i
       JOIN music_tracks t ON t.id = i.track_id
       WHERE i.playlist_id = ?
       ORDER BY i.position ASC`
    )
    stmt.bind([playlistId])
    const tracks: MusicTrack[] = []
    while (stmt.step()) {
      const track = rowToTrack(stmt.getAsObject() as Row)
      if (track) tracks.push(track)
    }
    stmt.free()
    return tracks
  }

  setPlaylistTracks(playlistId: string, trackIds: string[]): void {
    this.db.run('DELETE FROM music_playlist_items WHERE playlist_id = ?', [playlistId])
    trackIds.forEach((trackId, index) => {
      this.db.run(
        'INSERT INTO music_playlist_items (playlist_id, track_id, position) VALUES (?, ?, ?)',
        [playlistId, trackId, index]
      )
    })
    this.db.run('UPDATE music_playlists SET updated_at = ? WHERE id = ?', [Date.now(), playlistId])
    schedulePersistToDisk()
  }

  addPlaylistTracks(playlistId: string, trackIds: string[]): void {
    const existing = this.getPlaylistTracks(playlistId).map((track) => track.id)
    const merged = [...existing]
    for (const trackId of trackIds) {
      if (!merged.includes(trackId)) merged.push(trackId)
    }
    this.setPlaylistTracks(playlistId, merged)
  }

  removePlaylistTrack(playlistId: string, trackId: string): void {
    const remaining = this.getPlaylistTracks(playlistId)
      .map((track) => track.id)
      .filter((id) => id !== trackId)
    this.setPlaylistTracks(playlistId, remaining)
  }

  getQueue(): string[] {
    const result = this.db.exec('SELECT track_id FROM music_queue ORDER BY position ASC')
    if (result.length === 0) return []
    return result[0].values.map((row) => String(row[0]))
  }

  setQueue(trackIds: string[]): void {
    this.db.run('DELETE FROM music_queue')
    trackIds.forEach((trackId, index) => {
      this.db.run('INSERT INTO music_queue (position, track_id) VALUES (?, ?)', [index, trackId])
    })
    schedulePersistToDisk()
  }

  addToQueue(trackIds: string[]): void {
    const queue = this.getQueue()
    for (const trackId of trackIds) {
      if (!queue.includes(trackId)) queue.push(trackId)
    }
    this.setQueue(queue)
  }

  removeFromQueue(trackId: string): void {
    this.setQueue(this.getQueue().filter((id) => id !== trackId))
  }

  clearQueue(): void {
    this.db.run('DELETE FROM music_queue')
    schedulePersistToDisk()
  }

  listHistory(limit = 50): MusicHistoryEntry[] {
    const stmt = this.db.prepare(
      'SELECT * FROM music_history ORDER BY started_at DESC LIMIT ?'
    )
    stmt.bind([limit])
    const entries: MusicHistoryEntry[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row
      entries.push({
        id: String(row['id']),
        trackId: String(row['track_id']),
        startedAt: integer(row['started_at']) ?? 0,
        ...(integer(row['ended_at']) !== undefined ? { endedAt: integer(row['ended_at']) } : {}),
        ...(integer(row['listened_ms']) !== undefined ? { listenedMs: integer(row['listened_ms']) } : {}),
        source: (text(row['source']) ?? 'local') as MusicSource,
        ...(text(row['project_id']) ? { projectId: text(row['project_id']) } : {})
      })
    }
    stmt.free()
    return entries
  }

  insertHistory(entry: MusicHistoryEntry): void {
    this.db.run(
      `INSERT INTO music_history (id, track_id, started_at, ended_at, listened_ms, source, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.trackId,
        entry.startedAt,
        entry.endedAt ?? null,
        entry.listenedMs ?? null,
        entry.source,
        entry.projectId ?? null
      ]
    )
    schedulePersistToDisk()
  }

  updateHistoryListen(id: string, listenedMs: number, endedAt: number): void {
    this.db.run('UPDATE music_history SET listened_ms = ?, ended_at = ? WHERE id = ?', [
      listenedMs,
      endedAt,
      id
    ])
    schedulePersistToDisk()
  }
}

let musicStore: MusicStore | null = null

export function getMusicStore(): MusicStore | null {
  const db = getPersistenceDatabase()
  if (!db) return null
  if (!musicStore) musicStore = new MusicStore(db)
  return musicStore
}

const SETTINGS_KEY = 'music_settings_json'
const PLAYBACK_KEY = 'music_playback_json'

export function readMusicSettings(): MusicSettings {
  const db = getPersistenceDatabase()
  if (!db) return createDefaultMusicSettings()
  const result = db.exec('SELECT value FROM meta WHERE key = ?', [SETTINGS_KEY])
  if (result.length === 0 || result[0].values.length === 0) return createDefaultMusicSettings()
  const raw = result[0].values[0][0]
  const parsed = parseJson<Partial<MusicSettings>>(raw, {})
  const defaults = createDefaultMusicSettings()
  return {
    keepListeningHistory: typeof parsed.keepListeningHistory === 'boolean' ? parsed.keepListeningHistory : defaults.keepListeningHistory,
    associateWithProjects: typeof parsed.associateWithProjects === 'boolean' ? parsed.associateWithProjects : defaults.associateWithProjects,
    useInDeveloperInsights: typeof parsed.useInDeveloperInsights === 'boolean' ? parsed.useInDeveloperInsights : defaults.useInDeveloperInsights,
    libraryMode: parsed.libraryMode === 'managed' ? 'managed' : defaults.libraryMode,
    persistQueue: typeof parsed.persistQueue === 'boolean' ? parsed.persistQueue : defaults.persistQueue
  }
}

export function writeMusicSettings(settings: MusicSettings): MusicSettings {
  const db = getPersistenceDatabase()
  if (db) {
    db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [SETTINGS_KEY, JSON.stringify(settings)])
    schedulePersistToDisk()
  }
  return settings
}

export function readPlaybackSnapshot(): MusicPlaybackSnapshot | null {
  const db = getPersistenceDatabase()
  if (!db) return null
  const result = db.exec('SELECT value FROM meta WHERE key = ?', [PLAYBACK_KEY])
  if (result.length === 0 || result[0].values.length === 0) return null
  const parsed = parseJson<Partial<MusicPlaybackSnapshot>>(result[0].values[0][0], {})
  if (!parsed || typeof parsed !== 'object') return null
  const repeat: RepeatMode =
    parsed.repeat === 'one' || parsed.repeat === 'all' ? parsed.repeat : 'off'
  return {
    trackId: typeof parsed.trackId === 'string' ? parsed.trackId : null,
    positionMs: typeof parsed.positionMs === 'number' ? Math.max(0, parsed.positionMs) : 0,
    volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : 0.8,
    shuffle: Boolean(parsed.shuffle),
    repeat,
    queueTrackIds: Array.isArray(parsed.queueTrackIds)
      ? parsed.queueTrackIds.filter((id): id is string => typeof id === 'string')
      : [],
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
  }
}

export function writePlaybackSnapshot(snapshot: MusicPlaybackSnapshot): void {
  const db = getPersistenceDatabase()
  if (!db) return
  db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    PLAYBACK_KEY,
    JSON.stringify(snapshot)
  ])
  schedulePersistToDisk()
}
