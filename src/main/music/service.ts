import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import type {
  AddLinkResult,
  ImportTracksResult,
  MusicHistoryEntry,
  MusicLibrarySummary,
  MusicPlaybackSnapshot,
  MusicPlaylist,
  MusicSettings,
  MusicTrack
} from '@shared/contracts/music'
import { createDefaultMusicSettings } from '@shared/contracts/music'
import { deleteTrackAndFiles, importAudioPaths, offlineLibraryBytes, resolveTrackFilePath } from './library'
import { getDownloadJobRepository } from './downloader/job-store'
import { permanentlyDeleteManagedMusicFile } from './purge'
import { addStreamingLink } from './references'
import { downloadDirectAudio } from './download'
import { uniqueRecentlyPlayed } from './recent'
import { parseDirectAudioUrl, parseMusicUrl } from './url-parser'
import { openExternalUrl } from './open-external'
import { musicRootDir } from './paths'
import {
  getMusicStore,
  readMusicSettings,
  readPlaybackSnapshot,
  writeMusicSettings,
  writePlaybackSnapshot
} from './store'

export function initMusic(): void {
  try {
    musicRootDir()
    const store = getMusicStore()
    if (!store) return
    if (store.listPlaylists().length === 0) {
      const now = Date.now()
      store.createPlaylist({ id: randomUUID(), name: 'Favorites mix', createdAt: now, updatedAt: now })
    }
  } catch (error) {
    console.error('Music init failed:', error)
  }
}

export { resolveTrackFilePath }

export function listLibrary(): MusicTrack[] {
  return getMusicStore()?.listTracks() ?? []
}

export async function importPaths(paths: string[], mode?: MusicSettings['libraryMode']): Promise<ImportTracksResult> {
  const settings = readMusicSettings()
  return importAudioPaths(paths, mode ?? settings.libraryMode)
}

export async function removeTrack(id: string): Promise<boolean> {
  const jobs = getDownloadJobRepository()?.list().filter((job) => job.trackId === id) ?? []
  for (const job of jobs) {
    if (job.outputPath) {
      try {
        await permanentlyDeleteManagedMusicFile(job.outputPath)
      } catch {
        // job file already gone or unmanaged
      }
    }
    getDownloadJobRepository()?.remove(job.id)
  }
  return deleteTrackAndFiles(id)
}

export function updateTrackDuration(trackId: string, durationMs: number): boolean {
  const store = getMusicStore()
  if (!store || !store.getTrack(trackId)) return false
  store.updateTrackDuration(trackId, durationMs)
  return true
}

export async function librarySummary(): Promise<MusicLibrarySummary> {
  const store = getMusicStore()
  if (!store) {
    return { trackCount: 0, offlineCount: 0, offlineBytes: 0, favoriteCount: 0, playlistCount: 0 }
  }
  const tracks = store.listTracks()
  return {
    trackCount: tracks.length,
    offlineCount: tracks.filter((track) => track.isOfflineAvailable).length,
    offlineBytes: await offlineLibraryBytes(),
    favoriteCount: store.listFavorites().length,
    playlistCount: store.listPlaylists().length
  }
}

export function searchLibrary(query: string): MusicTrack[] {
  const store = getMusicStore()
  if (!store || !query.trim()) return store?.listTracks() ?? []
  return store.searchTracks(query.trim())
}

export function listFavorites(): MusicTrack[] {
  const store = getMusicStore()
  if (!store) return []
  const ids = new Set(store.listFavorites())
  return store.listTracks().filter((track) => ids.has(track.id))
}

export function toggleFavorite(trackId: string): boolean {
  return getMusicStore()?.toggleFavorite(trackId) ?? false
}

export function listRecentlyPlayed(limit = 30): MusicTrack[] {
  const store = getMusicStore()
  if (!store) return []
  return uniqueRecentlyPlayed(store.listTracks(), limit)
}

export function listPlaylists(): MusicPlaylist[] {
  return getMusicStore()?.listPlaylists() ?? []
}

export function createPlaylist(name: string): MusicPlaylist | null {
  const store = getMusicStore()
  if (!store) return null
  const now = Date.now()
  const playlist = { id: randomUUID(), name, createdAt: now, updatedAt: now }
  store.createPlaylist(playlist)
  return playlist
}

export function renamePlaylist(id: string, name: string): boolean {
  const store = getMusicStore()
  if (!store) return false
  store.renamePlaylist(id, name, Date.now())
  return true
}

export function deletePlaylist(id: string): boolean {
  getMusicStore()?.deletePlaylist(id)
  return true
}

export function getPlaylistTracks(playlistId: string): MusicTrack[] {
  return getMusicStore()?.getPlaylistTracks(playlistId) ?? []
}

export function addPlaylistTracks(playlistId: string, trackIds: string[]): void {
  getMusicStore()?.addPlaylistTracks(playlistId, trackIds)
}

export function removePlaylistTrack(playlistId: string, trackId: string): void {
  getMusicStore()?.removePlaylistTrack(playlistId, trackId)
}

export function reorderPlaylist(playlistId: string, trackIds: string[]): void {
  getMusicStore()?.setPlaylistTracks(playlistId, trackIds)
}

export function getQueue(): string[] {
  return getMusicStore()?.getQueue() ?? []
}

export function setQueue(trackIds: string[]): void {
  getMusicStore()?.setQueue(trackIds)
}

export function addToQueue(trackIds: string[]): void {
  getMusicStore()?.addToQueue(trackIds)
}

export function removeFromQueue(trackId: string): void {
  getMusicStore()?.removeFromQueue(trackId)
}

export function clearQueue(): void {
  getMusicStore()?.clearQueue()
}

export function reorderQueue(trackIds: string[]): void {
  getMusicStore()?.setQueue(trackIds)
}

export function getSettings(): MusicSettings {
  return readMusicSettings()
}

export function updateSettings(updates: Partial<MusicSettings>): MusicSettings {
  const next = { ...readMusicSettings(), ...updates }
  return writeMusicSettings(next)
}

export function getPlaybackSnapshot(): MusicPlaybackSnapshot | null {
  return readPlaybackSnapshot()
}

export function savePlaybackSnapshot(snapshot: MusicPlaybackSnapshot): void {
  writePlaybackSnapshot(snapshot)
}

export async function ensurePlayableTrack(
  trackId: string,
  force = false
): Promise<{ ok: true; converted: boolean; filePath: string } | { ok: false; error: string }> {
  const { ensurePlayableTrackFile } = await import('./transcode')
  const prepared = await ensurePlayableTrackFile(trackId, force)
  if (prepared.ok) {
    const { ensureTrackArtwork } = await import('./artwork')
    await ensureTrackArtwork(trackId).catch(() => null)
  }
  return prepared
}

export async function readPlaybackMedia(
  trackId: string
): Promise<{ ok: true; mime: string; data: Uint8Array } | { ok: false; error: string }> {
  const prepared = await ensurePlayableTrack(trackId)
  if (!prepared.ok) return prepared
  try {
    const data = await readFile(prepared.filePath)
    if (data.byteLength === 0) return { ok: false, error: 'Track file is empty' }
    const { mimeForAudioKind, sniffAudioFile } = await import('./audio-format')
    const kind = await sniffAudioFile(prepared.filePath)
    return {
      ok: true,
      mime: mimeForAudioKind(kind === 'unknown' ? 'mp3' : kind),
      data: new Uint8Array(data)
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not read track file' }
  }
}

export function checkTrackAvailable(trackId: string): { ok: boolean; reason?: string } {
  const store = getMusicStore()
  const track = store?.getTrack(trackId)
  if (!track) return { ok: false, reason: 'Track not found' }
  if (track.filePath && track.isOfflineAvailable) {
    return existsSync(track.filePath) ? { ok: true } : { ok: false, reason: 'File missing or moved' }
  }
  if (track.source === 'youtube') {
    return track.sourceId
      ? { ok: true }
      : { ok: false, reason: 'Invalid YouTube reference' }
  }
  if (!track.filePath) return { ok: false, reason: 'Streaming reference — not playable offline' }
  if (!existsSync(track.filePath)) return { ok: false, reason: 'File missing or moved' }
  return { ok: true }
}

export async function addLink(url: string): Promise<AddLinkResult> {
  if (parseDirectAudioUrl(url)) return downloadDirectAudio(url)
  const parsed = parseMusicUrl(url)
  if (parsed) return addStreamingLink(url)
  return {
    ok: false,
    error: 'Unsupported link. Paste a YouTube URL, or a direct link to an audio file (.mp3, .wav, …).'
  }
}

export { openExternalUrl }

export { searchYouTubeVideos } from './youtube-search'

export function recordPlay(request: { trackId: string; projectId?: string }): { historyId: string | null } {
  const store = getMusicStore()
  if (!store) return { historyId: null }
  const track = store.getTrack(request.trackId)
  if (!track) return { historyId: null }
  const now = Date.now()
  store.markPlayed(request.trackId, now)

  const settings = readMusicSettings()
  if (!settings.keepListeningHistory) return { historyId: null }

  const entry: MusicHistoryEntry = {
    id: randomUUID(),
    trackId: request.trackId,
    startedAt: now,
    source: track.source,
    ...(settings.associateWithProjects && request.projectId ? { projectId: request.projectId } : {})
  }
  store.insertHistory(entry)
  return { historyId: entry.id }
}

export function recordListen(historyId: string, listenedMs: number): void {
  getMusicStore()?.updateHistoryListen(historyId, listenedMs, Date.now())
}

export function listHistory(limit = 50): MusicHistoryEntry[] {
  return getMusicStore()?.listHistory(limit) ?? []
}

export function resetMusicSettings(): MusicSettings {
  return writeMusicSettings(createDefaultMusicSettings())
}
