import { app, BrowserWindow, clipboard, dialog, shell } from 'electron'
import { existsSync } from 'fs'
import { mkdir, stat, unlink } from 'fs/promises'
import { extname, join } from 'path'
import type {
  AnalyzeResult,
  DownloadEngineStatus,
  DownloadEvent,
  DownloadJob,
  DownloadRequest,
  DownloadSettings,
  MediaAnalysis,
  StartDownloadResult
} from '@shared/contracts/downloads'
import { MUSIC_DOWNLOAD_IPC } from '@shared/contracts/downloads'
import { MUSIC_AUDIO_EXTENSIONS } from '@shared/contracts/music'
import { deleteTrackAndFiles, importDownloadedAudio } from '../library'
import { permanentlyDeleteManagedMusicFile } from '../purge'
import { getMusicStore } from '../store'
import { assertParentInside, assertPathInside, sanitizeFilename, uniqueFilename } from './filenames'
import { detectDownloadEngine, ffmpegDirectory } from './binaries'
import { installOfficialEngine } from './install'
import { analyzeWithEngine, cleanupDownloadArtifacts, downloadWithEngine } from './engine'
import { BEST_AUDIO_SELECTOR } from './formats'
import { getDownloadJobRepository, type DownloadJobRepository } from './job-store'
import { DownloadQueue, type QueueRunner } from './queue'
import { readDownloadSettings, resolveDownloadFolder, writeDownloadSettings } from './settings'
import { isPrivateResolvedAddress, validateDownloadUrl } from './url-safety'
import { lookup } from 'dns/promises'

const MIN_FREE_BYTES = 40 * 1024 * 1024

let queue: DownloadQueue | null = null
let cachedEngine: DownloadEngineStatus | null = null

function broadcast(event: DownloadEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    try {
      window.webContents.send(MUSIC_DOWNLOAD_IPC.EVENT, event)
    } catch {
      // window disappeared
    }
  }
}

async function assertPublicDestination(url: string): Promise<void> {
  const parsed = new URL(url)
  try {
    const resolved = await lookup(parsed.hostname, { all: true })
    if (resolved.some((entry) => isPrivateResolvedAddress(entry.address))) {
      throw new Error('This host resolved to an internal address and was blocked')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('internal address')) throw error
    // DNS failure is handled later by the engine
  }
}

async function ensureFreeSpace(directory: string): Promise<void> {
  try {
    const stats = await statfsSafe(directory)
    if (stats !== null && stats < MIN_FREE_BYTES) {
      throw new Error('Not enough free disk space for this download')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('free disk space')) throw error
  }
}

async function statfsSafe(directory: string): Promise<number | null> {
  try {
    const { statfs } = await import('fs/promises')
    const info = await statfs(directory)
    return Number(info.bavail) * Number(info.bsize)
  } catch {
    return null
  }
}

function allowedRoots(): string[] {
  const roots = [resolveDownloadFolder()]
  try {
    roots.push(join(app.getPath('userData'), 'music', 'library'))
    roots.push(join(app.getPath('userData'), 'music', 'downloads'))
  } catch {
    // ignore
  }
  return roots
}

function assertManagedOutput(path: string): string {
  let lastError: Error | null = null
  for (const root of allowedRoots()) {
    try {
      return assertPathInside(root, path)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Invalid path')
    }
  }
  throw lastError ?? new Error('Path is outside the managed download folder')
}

function createRunner(): QueueRunner {
  return {
    async analyze(url, signal) {
      const engine = await ensureDownloadEngine()
      if (!engine.ytDlp.path) throw new Error(ENGINE_PREPARE_ERROR)
      return analyzeWithEngine(engine.ytDlp.path, url, engine.ffmpeg.available, signal)
    },
    async download(job, onProgress, signal) {
      const engine = await ensureDownloadEngine()
      if (!engine.ytDlp.path) throw new Error(ENGINE_PREPARE_ERROR)
      if (job.mode === 'audio' && !engine.ffmpeg.available) throw new Error(ENGINE_PREPARE_ERROR)
      await mkdir(job.destination, { recursive: true })
      assertPathInside(job.destination, job.destination)
      await ensureFreeSpace(job.destination)
      const base = uniqueFilename(job.destination, sanitizeFilename(job.title || 'download'), job.outputExt)
      const expectedPath = join(job.destination, base)
      assertParentInside(job.destination, expectedPath)
      const outputTemplate = expectedPath.replace(/\.[^.]+$/, '.%(ext)s')
      const settings = readDownloadSettings()
      const result = await downloadWithEngine({
        binary: engine.ytDlp.path,
        url: job.sourceUrl,
        mode: job.mode,
        formatId: job.formatId,
        outputTemplate,
        expectedPath,
        isConversion: job.isConversion,
        outputExt: job.outputExt,
        audioQuality: settings.defaultAudioQuality === 'standard' ? '5' : '0',
        ...(engine.ffmpeg.path ? { ffmpegPath: ffmpegDirectory(engine.ffmpeg.path) ?? engine.ffmpeg.path } : {}),
        signal,
        onProgress
      })
      assertManagedOutput(result.outputPath)
      const info = await stat(result.outputPath)
      if (!info.isFile() || info.size <= 0) {
        throw new Error('Downloaded file is empty')
      }
      if (job.mode !== 'audio') return result
      const { normalizeDownloadedAudio } = await import('../transcode')
      const playablePath = await normalizeDownloadedAudio(result.outputPath)
      assertManagedOutput(playablePath)
      return { outputPath: playablePath }
    },
    async importCompleted(job, outputPath) {
      if (job.mode !== 'audio') return undefined
      if (!MUSIC_AUDIO_EXTENSIONS.has(extname(outputPath).toLowerCase())) return undefined
      const imported = await importDownloadedAudio(outputPath, {
        mode: 'managed',
        ...(job.title ? { title: job.title } : {}),
        ...(job.creator ? { artist: job.creator } : {}),
        sourceUrl: job.sourceUrl
      })
      if (!imported.ok) throw new Error(imported.error)
      const { ensureTrackArtwork } = await import('../artwork')
      await ensureTrackArtwork(imported.track.id, outputPath).catch(() => null)
      if (job.playlistId) getMusicStore()?.addPlaylistTracks(job.playlistId, [imported.track.id])
      return imported.track.id
    },
    async cleanup(outputPath) {
      if (!outputPath) return
      try {
        assertManagedOutput(outputPath)
      } catch {
        return
      }
      await cleanupDownloadArtifacts(outputPath)
      if (existsSync(`${outputPath}.part`)) {
        try {
          await unlink(`${outputPath}.part`)
        } catch {
          // ignore
        }
      }
    }
  }
}

function ensureQueue(store: DownloadJobRepository): DownloadQueue {
  if (!queue) {
    queue = new DownloadQueue({
      store,
      runner: createRunner(),
      getConcurrency: () => readDownloadSettings().maxConcurrentDownloads,
      onUpdate: (job) => broadcast({ type: 'updated', job })
    })
    queue.recover()
  }
  return queue
}

const ENGINE_PREPARE_ERROR = 'Could not prepare the downloader. Check your internet connection and try again.'

let engineEnsure: Promise<DownloadEngineStatus> | null = null

export async function initDownloadManager(): Promise<void> {
  const store = getDownloadJobRepository()
  if (!store) return
  cachedEngine = await detectDownloadEngine()
  ensureQueue(store)
  if (!cachedEngine.ytDlp.available || !cachedEngine.ffmpeg.available) {
    void ensureDownloadEngine()
  }
}

export function disposeDownloadManager(): void {
  queue?.dispose()
  queue = null
}

async function applyEngine(engine: DownloadEngineStatus, rebuildQueue = false): Promise<DownloadEngineStatus> {
  cachedEngine = engine
  const store = getDownloadJobRepository()
  if (store && engine.ytDlp.available && (rebuildQueue || !queue)) {
    if (rebuildQueue) queue = null
    ensureQueue(store)
  }
  return engine
}

async function ensureDownloadEngine(): Promise<DownloadEngineStatus> {
  const current = await detectDownloadEngine()
  if (current.ytDlp.available && current.ffmpeg.available) {
    return applyEngine(current)
  }
  if (!engineEnsure) {
    engineEnsure = installOfficialEngine()
      .then((result) => applyEngine(result.engine, true))
      .finally(() => {
        engineEnsure = null
      })
  }
  return engineEnsure
}

export async function getDownloadEngineStatus(): Promise<DownloadEngineStatus> {
  cachedEngine = await detectDownloadEngine()
  return cachedEngine
}

export async function installDownloadEngine(): Promise<import('@shared/contracts/downloads').EngineInstallResult> {
  const result = await installOfficialEngine()
  cachedEngine = result.engine
  const store = getDownloadJobRepository()
  if (store && result.engine.ytDlp.available) {
    queue = null
    ensureQueue(store)
  }
  return result
}

export async function analyzeDownloadUrl(rawUrl: string): Promise<AnalyzeResult> {
  const validated = validateDownloadUrl(rawUrl)
  if (!validated.ok) return { ok: false, error: validated.error }
  await assertPublicDestination(validated.url)
  try {
    const engine = await ensureDownloadEngine()
    if (!engine.ytDlp.available || !engine.ytDlp.path) {
      return { ok: false, error: ENGINE_PREPARE_ERROR }
    }
    const analysis = await analyzeWithEngine(engine.ytDlp.path, validated.url, engine.ffmpeg.available)
    return { ok: true, analysis }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Analysis failed' }
  }
}

export async function startDownload(
  request: DownloadRequest,
  analysis?: Pick<MediaAnalysis, 'title' | 'creator' | 'sourceType'>
): Promise<StartDownloadResult> {
  const validated = validateDownloadUrl(request.sourceUrl)
  if (!validated.ok) return { ok: false, error: validated.error }
  await assertPublicDestination(validated.url)

  const settings = readDownloadSettings()
  if (request.mode === 'audio') {
    request = {
      ...request,
      formatId: BEST_AUDIO_SELECTOR,
      outputExt: 'mp3',
      isConversion: true,
      importToLibrary: true
    }
  }

  const store = getDownloadJobRepository()
  if (!store) return { ok: false, error: 'Database is not ready' }
  const manager = ensureQueue(store)
  const destination = resolveDownloadFolder()
  await mkdir(destination, { recursive: true })
  await ensureFreeSpace(destination)

  const job = manager.enqueue(request, {
    destination,
    ...(analysis?.title ? { title: analysis.title } : {}),
    ...(analysis?.creator ? { creator: analysis.creator } : {}),
    ...(analysis?.sourceType ? { sourceType: analysis.sourceType } : {}),
    quality: settings.defaultAudioQuality
  })
  return { ok: true, job }
}

export function listDownloadJobs(): DownloadJob[] {
  const store = getDownloadJobRepository()
  return store?.list() ?? queue?.list() ?? []
}

export async function deleteDownloadJob(id: string): Promise<{ ok: boolean; error?: string }> {
  const store = getDownloadJobRepository()
  if (!store) return { ok: false, error: 'Database is not ready' }
  const job = store.get(id)
  if (!job) return { ok: false, error: 'Download not found' }

  const active =
    job.status === 'pending' ||
    job.status === 'analyzing' ||
    job.status === 'downloading' ||
    job.status === 'processing'
  if (active) {
    await cancelDownloadJob(id)
  }

  const latest = store.get(id) ?? job
  if (latest.outputPath) {
    try {
      await permanentlyDeleteManagedMusicFile(latest.outputPath)
    } catch {
      // already gone
    }
    try {
      await cleanupDownloadArtifacts(latest.outputPath)
    } catch {
      // ignore leftover cleanup
    }
  }

  if (latest.trackId) {
    await deleteTrackAndFiles(latest.trackId)
  }

  store.remove(id)
  broadcast({ type: 'removed', job: { ...latest, outputPath: undefined, trackId: undefined } })
  return { ok: true }
}

export async function cancelDownloadJob(id: string): Promise<boolean> {
  const store = getDownloadJobRepository()
  if (!store) return false
  return ensureQueue(store).cancel(id)
}

export async function retryDownloadJob(id: string): Promise<{ ok: boolean; error?: string }> {
  const store = getDownloadJobRepository()
  if (!store) return { ok: false, error: 'Database is not ready' }
  const job = ensureQueue(store).retry(id)
  return job ? { ok: true } : { ok: false, error: 'Job cannot be retried' }
}

export function clearDownloadHistory(): { ok: true; removed: number } {
  const store = getDownloadJobRepository()
  if (!store) return { ok: true, removed: 0 }
  if (!readDownloadSettings().keepHistory) {
    return { ok: true, removed: store.clearTerminal() }
  }
  const removed = store.clearTerminal()
  return { ok: true, removed }
}

export function getDownloadSettings(): DownloadSettings {
  return readDownloadSettings()
}

export function updateDownloadSettings(updates: Partial<DownloadSettings>): DownloadSettings {
  return writeDownloadSettings({ ...readDownloadSettings(), ...updates })
}

export async function pickDownloadFolder(event: Electron.IpcMainInvokeEvent): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: 'Select download folder',
        properties: ['openDirectory', 'createDirectory']
      })
    : await dialog.showOpenDialog({
        title: 'Select download folder',
        properties: ['openDirectory', 'createDirectory']
      })
  if (result.canceled || !result.filePaths[0]) return null
  const folder = result.filePaths[0]
  updateDownloadSettings({ defaultFolder: folder })
  return folder
}

function jobOutputPath(jobId: string): string {
  const store = getDownloadJobRepository()
  const job = store?.get(jobId)
  if (!job?.outputPath) throw new Error('No output file for this download')
  return assertManagedOutput(job.outputPath)
}

export async function openDownloadFile(jobId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const path = jobOutputPath(jobId)
    const error = await shell.openPath(path)
    return error ? { ok: false, error } : { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not open file' }
  }
}

export async function openDownloadFolder(jobId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const path = jobOutputPath(jobId)
    shell.showItemInFolder(path)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not open folder' }
  }
}

export async function openDownloadsDirectory(): Promise<{ ok: boolean; error?: string }> {
  try {
    const folder = resolveDownloadFolder()
    const error = await shell.openPath(folder)
    return error ? { ok: false, error } : { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not open folder' }
  }
}

export function copyDownloadPath(jobId: string): { ok: boolean; path?: string; error?: string } {
  try {
    const path = jobOutputPath(jobId)
    clipboard.writeText(path)
    return { ok: true, path }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not copy path' }
  }
}

export { assertManagedOutput }
