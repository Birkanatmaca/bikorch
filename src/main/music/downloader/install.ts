import { execFile } from 'child_process'
import { createWriteStream, existsSync } from 'fs'
import { copyFile, mkdir, readdir, readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { promisify } from 'util'
import { net } from 'electron'
import { detectDownloadEngine, managedBinDir } from './binaries'
import { FFMPEG_WINDOWS_ZIP_URL, YTDLP_WINDOWS_URL } from './official-urls'

export { FFMPEG_WINDOWS_ZIP_URL, YTDLP_WINDOWS_URL }

const execFileAsync = promisify(execFile)

const YTDLP_MAX_BYTES = 40 * 1024 * 1024
const FFMPEG_ZIP_MAX_BYTES = 120 * 1024 * 1024
const FETCH_TIMEOUT_MS = 180_000

export interface EngineInstallResult {
  ok: boolean
  error?: string
  engine: Awaited<ReturnType<typeof detectDownloadEngine>>
}

function isWindowsPe(buffer: Buffer): boolean {
  return buffer.length > 2 && buffer[0] === 0x4d && buffer[1] === 0x5a
}

async function downloadOfficialFileTo(url: string, destPath: string, maxBytes: number): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await net.fetch(url, { redirect: 'follow', signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Official download failed (HTTP ${response.status})`)
    }
    if (!response.body) throw new Error('Official download was empty')
    const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream)
    let received = 0
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > maxBytes) {
        nodeStream.destroy(new Error('Official download was unexpectedly large'))
      }
    })
    await pipeline(nodeStream, createWriteStream(destPath))
    if (received === 0) throw new Error('Official download was empty')
  } finally {
    clearTimeout(timer)
  }
}

async function findFile(dir: string, name: string): Promise<string | null> {
  const preferred = join(dir, 'bin', name)
  if (existsSync(preferred)) return preferred
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const nestedBin = join(dir, entry.name, 'bin', name)
    if (existsSync(nestedBin)) return nestedBin
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === name) return full
    if (entry.isDirectory()) {
      const nested = await findFile(full, name)
      if (nested) return nested
    }
  }
  return null
}

async function extractFfmpeg(zipPath: string, destDir: string): Promise<void> {
  const extractDir = join(tmpdir(), `bikorch-ffmpeg-${Date.now()}`)
  await mkdir(extractDir, { recursive: true })
  try {
    await execFileAsync('tar.exe', ['-xf', zipPath, '-C', extractDir], {
      timeout: 120_000,
      windowsHide: true
    })
  } catch {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        'Expand-Archive -LiteralPath $env:BIKORCH_ZIP -DestinationPath $env:BIKORCH_OUT -Force'
      ],
      {
        timeout: 120_000,
        windowsHide: true,
        env: {
          ...process.env,
          BIKORCH_ZIP: zipPath,
          BIKORCH_OUT: extractDir
        }
      }
    )
  }
  const ffmpeg = await findFile(extractDir, 'ffmpeg.exe')
  if (!ffmpeg) throw new Error('The FFmpeg archive did not contain ffmpeg.exe')
  await copyFile(ffmpeg, join(destDir, 'ffmpeg.exe'))
  const ffprobe = await findFile(extractDir, 'ffprobe.exe')
  if (ffprobe) await copyFile(ffprobe, join(destDir, 'ffprobe.exe'))
}

async function installYtdlp(destDir: string): Promise<void> {
  const dest = join(destDir, 'yt-dlp.exe')
  await downloadOfficialFileTo(YTDLP_WINDOWS_URL, dest, YTDLP_MAX_BYTES)
  const header = await readFile(dest)
  if (!isWindowsPe(header.subarray(0, 2))) {
    await unlink(dest)
    throw new Error('yt-dlp download was not a Windows executable')
  }
}

async function installFfmpeg(destDir: string): Promise<void> {
  const zipPath = join(tmpdir(), `bikorch-ffmpeg-${Date.now()}.zip`)
  try {
    await downloadOfficialFileTo(FFMPEG_WINDOWS_ZIP_URL, zipPath, FFMPEG_ZIP_MAX_BYTES)
    await extractFfmpeg(zipPath, destDir)
  } finally {
    if (existsSync(zipPath)) await unlink(zipPath)
  }
}

export async function installOfficialEngine(): Promise<EngineInstallResult> {
  const destDir = managedBinDir()
  await mkdir(destDir, { recursive: true })
  const current = await detectDownloadEngine()

  const tasks: Promise<void>[] = []
  if (!current.ytDlp.available) tasks.push(installYtdlp(destDir))
  if (!current.ffmpeg.available) tasks.push(installFfmpeg(destDir))

  if (tasks.length === 0) {
    return { ok: true, engine: current }
  }

  const results = await Promise.allSettled(tasks)
  const failed = results.find((result) => result.status === 'rejected')
  const engine = await detectDownloadEngine()
  if (!engine.ytDlp.available) {
    return {
      ok: false,
      error: failed && failed.status === 'rejected' ? String(failed.reason) : 'Could not prepare the downloader',
      engine
    }
  }
  return { ok: true, engine }
}
