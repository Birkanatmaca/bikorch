import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { extname, join } from 'path'
import { isElectronPlayable, sniffAudioFile, type AudioKind } from './audio-format'
import { detectDownloadEngine } from './downloader/binaries'
import { managedLibraryDir } from './paths'
import { getMusicStore } from './store'

export function needsPlaybackTranscode(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return ext === '.webm' || ext === '.opus' || ext === '.ogg' || ext === '.oga' || ext === '.mkv' || ext === '.mp4'
}

export function buildMp3Args(input: string, output: string): string[] {
  if (!input || !output || input.includes('\0') || output.includes('\0')) {
    throw new Error('Invalid transcode path')
  }
  if (extname(output).toLowerCase() !== '.mp3') {
    throw new Error('Playback transcode must write an MP3 file')
  }
  return ['-y', '-i', input, '-vn', '-c:a', 'libmp3lame', '-b:a', '320k', output]
}

export function buildAacM4aArgs(input: string, output: string): string[] {
  if (!input || !output || input.includes('\0') || output.includes('\0')) {
    throw new Error('Invalid transcode path')
  }
  if (extname(output).toLowerCase() !== '.m4a') {
    throw new Error('Playback transcode must write an M4A file')
  }
  return ['-y', '-i', input, '-vn', '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', output]
}

export function sameAudioPath(left: string, right: string): boolean {
  return left.replace(/\\/g, '/').toLowerCase() === right.replace(/\\/g, '/').toLowerCase()
}

function isAlreadyPlayableMp3(kind: AudioKind, filePath: string): boolean {
  return kind === 'mp3' || (isElectronPlayable(kind) && extname(filePath).toLowerCase() === '.mp3')
}

function assertManagedOutput(output: string): void {
  const root = managedLibraryDir().replace(/\\/g, '/').toLowerCase()
  const target = output.replace(/\\/g, '/').toLowerCase()
  if (!target.startsWith(`${root}/`) && target !== root) {
    throw new Error('Transcode output must stay in the music library folder')
  }
}

async function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Audio conversion timed out'))
    }, 20 * 60_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(stderr.trim() || 'Could not convert this file to MP3'))
    })
  })
}

export async function convertFileToMp3(inputPath: string, outputPath: string): Promise<string> {
  if (sameAudioPath(inputPath, outputPath)) {
    return inputPath
  }
  const engine = await detectDownloadEngine()
  if (!engine.ffmpeg.path) {
    throw new Error('FFmpeg is not ready yet. Try again in a moment.')
  }
  assertManagedOutput(outputPath)
  await runFfmpeg(engine.ffmpeg.path, buildMp3Args(inputPath, outputPath))
  if (!existsSync(outputPath)) {
    throw new Error('Converted MP3 was not created')
  }
  return outputPath
}

export async function normalizeDownloadedAudio(filePath: string): Promise<string> {
  const kind = await sniffAudioFile(filePath)
  if (isElectronPlayable(kind) && kind !== 'unknown') {
    if (kind === 'm4a' || kind === 'mp3' || kind === 'wav' || kind === 'flac') {
      return filePath
    }
  }
  const output = join(managedLibraryDir(), `dl-${Date.now()}.mp3`)
  return convertFileToMp3(filePath, output)
}

export async function ensurePlayableTrackFile(
  trackId: string,
  force = false
): Promise<{ ok: true; converted: boolean; filePath: string } | { ok: false; error: string }> {
  const store = getMusicStore()
  const track = store?.getTrack(trackId)
  if (!store || !track?.filePath) return { ok: false, error: 'Track file is missing' }
  if (!existsSync(track.filePath)) return { ok: false, error: 'Track file is missing' }

  const kind = await sniffAudioFile(track.filePath)
  if (isAlreadyPlayableMp3(kind, track.filePath)) {
    return { ok: true, converted: false, filePath: track.filePath }
  }
  if (!force && isElectronPlayable(kind) && !needsPlaybackTranscode(track.filePath)) {
    return { ok: true, converted: false, filePath: track.filePath }
  }

  try {
    const output = sameAudioPath(track.filePath, join(managedLibraryDir(), `${trackId}.mp3`))
      ? join(managedLibraryDir(), `${trackId}.play.mp3`)
      : join(managedLibraryDir(), `${trackId}.mp3`)
    await convertFileToMp3(track.filePath, output)
    store.upsertTrack(
      {
        ...track,
        filePath: output,
        storageMode: 'managed',
        isOfflineAvailable: true
      },
      output.replace(/\\/g, '/').toLowerCase()
    )
    return { ok: true, converted: true, filePath: output }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not convert this file' }
  }
}
