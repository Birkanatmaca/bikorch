import { randomUUID } from 'crypto'
import { copyFile, stat } from 'fs/promises'
import { basename, extname, join, normalize } from 'path'
import { existsSync } from 'fs'
import type { ImportTracksResult, MusicStorageMode, MusicTrack } from '@shared/contracts/music'
import { metadataFromFilename, isAudioExtension } from './metadata'
import { artworkDir, managedLibraryDir } from './paths'
import { permanentlyDeleteManagedMusicFile } from './purge'
import { getMusicStore } from './store'
import { parseMusicUrl } from './url-parser'

function canonicalPath(path: string): string {
  return normalize(path).replace(/\\/g, '/').toLowerCase()
}

async function collectAudioFiles(paths: string[]): Promise<string[]> {
  const { readdir } = await import('fs/promises')
  const out: string[] = []

  async function walk(target: string): Promise<void> {
    if (!existsSync(target)) return
    const info = await stat(target)
    if (info.isFile()) {
      if (isAudioExtension(extname(target))) out.push(target)
      return
    }
    if (!info.isDirectory()) return
    const entries = await readdir(target, { withFileTypes: true })
    for (const entry of entries) {
      await walk(join(target, entry.name))
    }
  }

  for (const path of paths) {
    await walk(path)
  }
  return out
}

async function resolveStoredPath(
  sourcePath: string,
  mode: MusicStorageMode,
  trackId: string
): Promise<string> {
  if (mode !== 'managed') return sourcePath
  const ext = extname(sourcePath) || '.mp3'
  const destination = join(managedLibraryDir(), `${trackId}${ext}`)
  await copyFile(sourcePath, destination)
  return destination
}

export async function importAudioPaths(
  paths: string[],
  mode: MusicStorageMode
): Promise<ImportTracksResult> {
  const store = getMusicStore()
  const result: ImportTracksResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    tracks: [],
    errors: []
  }
  if (!store) {
    result.errors.push('Database is not ready')
    return result
  }

  const files = await collectAudioFiles(paths)
  for (const filePath of files) {
    try {
      const canonical = canonicalPath(filePath)
      const existing = store.findByCanonicalPath(canonical)
      if (existing) {
        result.skipped += 1
        continue
      }
      if (!existsSync(filePath)) {
        result.failed += 1
        result.errors.push(`Missing file: ${basename(filePath)}`)
        continue
      }

      const id = randomUUID()
      const storedPath = await resolveStoredPath(filePath, mode, id)
      const meta = metadataFromFilename(filePath)
      const track: MusicTrack = {
        id,
        title: meta.title,
        ...(meta.artist ? { artist: meta.artist } : {}),
        filePath: storedPath,
        source: 'local',
        isOfflineAvailable: true,
        storageMode: mode === 'managed' ? 'managed' : 'reference',
        addedAt: Date.now(),
        playCount: 0
      }
      store.upsertTrack(track, canonical)
      result.imported += 1
      result.tracks.push(track)
    } catch (error) {
      result.failed += 1
      result.errors.push(error instanceof Error ? error.message : `Failed: ${basename(filePath)}`)
    }
  }

  return result
}

export async function importDownloadedAudio(
  filePath: string,
  options: {
    mode: MusicStorageMode
    title?: string
    artist?: string
    sourceUrl?: string
    durationMs?: number
    artworkPath?: string
  }
): Promise<{ ok: true; track: MusicTrack; duplicate: boolean } | { ok: false; error: string }> {
  const store = getMusicStore()
  if (!store) return { ok: false, error: 'Database is not ready' }
  if (!existsSync(filePath)) return { ok: false, error: 'Downloaded file is missing' }
  if (!isAudioExtension(extname(filePath))) {
    return { ok: false, error: 'Downloaded file is not a supported audio format' }
  }

  const canonical = canonicalPath(filePath)
  const existing = store.findByCanonicalPath(canonical)
  if (existing) return { ok: true, track: existing, duplicate: true }

  const id = randomUUID()
  const storedPath = await resolveStoredPath(filePath, options.mode, id)
  const meta = metadataFromFilename(filePath)
  const parsed = options.sourceUrl ? parseMusicUrl(options.sourceUrl) : null
  const track: MusicTrack = {
    id,
    title: options.title?.trim() || meta.title,
    ...(options.artist || meta.artist ? { artist: options.artist || meta.artist } : {}),
    filePath: storedPath,
    source: parsed?.source ?? 'local',
    ...(parsed?.sourceId ? { sourceId: parsed.sourceId } : {}),
    ...(parsed?.sourceUrl || options.sourceUrl
      ? { sourceUrl: parsed?.sourceUrl ?? options.sourceUrl }
      : {}),
    ...(options.durationMs ? { durationMs: options.durationMs } : {}),
    ...(options.artworkPath ? { artworkPath: options.artworkPath } : {}),
    isOfflineAvailable: true,
    storageMode: options.mode === 'managed' ? 'managed' : 'reference',
    addedAt: Date.now(),
    playCount: 0
  }
  store.upsertTrack(track, canonical)
  return { ok: true, track, duplicate: false }
}

export async function deleteTrackAndFiles(trackId: string): Promise<boolean> {
  const store = getMusicStore()
  const track = store?.getTrack(trackId)
  if (!store || !track) return false
  if (track.filePath) {
    try {
      await permanentlyDeleteManagedMusicFile(track.filePath)
    } catch {
      // reference files outside the app folder stay on disk
    }
  }
  if (track.artworkPath) {
    try {
      await permanentlyDeleteManagedMusicFile(track.artworkPath)
    } catch {
      // ignore unmanaged artwork
    }
  }
  store.removeTrack(trackId)
  return true
}

export function resolveTrackFilePath(trackId: string): string | null {
  const store = getMusicStore()
  if (!store) return null
  const track = store.getTrack(trackId)
  if (!track?.filePath || !track.isOfflineAvailable) return null
  if (!existsSync(track.filePath)) return null
  return track.filePath
}

export function resolveArtworkFilePath(trackId: string): string | null {
  const store = getMusicStore()
  if (!store) return null
  const track = store.getTrack(trackId)
  if (track?.artworkPath && !/^https?:\/\//i.test(track.artworkPath) && existsSync(track.artworkPath)) {
    return track.artworkPath
  }
  const root = artworkDir()
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const candidate = join(root, `${trackId}${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export async function offlineLibraryBytes(): Promise<number> {
  const store = getMusicStore()
  if (!store) return 0
  let total = 0
  for (const track of store.listTracks()) {
    if (!track.filePath || !track.isOfflineAvailable) continue
    try {
      const info = await stat(track.filePath)
      if (info.isFile()) total += info.size
    } catch {
      // ignore missing files
    }
  }
  return total
}
