import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import type { MediaAnalysis } from '@shared/contracts/downloads'
import { buildAnalyzeArgs, buildDownloadArgs, parseDownloadProgress } from './args'
import { mapEngineError } from './url-safety'
import { parseYtdlpInfo, buildMediaAnalysis } from './formats'
import { tempSidecars } from './filenames'

const MAX_STREAM_BYTES = 2 * 1024 * 1024
const ANALYZE_TIMEOUT_MS = 90_000
const STALL_TIMEOUT_MS = 15 * 60_000

export interface EngineProgress {
  percent?: number
  speedBytesPerSec?: number
  etaSec?: number
}

export interface DownloadEngineRun {
  outputPath: string
}

export interface SpawnedJob {
  child: ChildProcess
  wait: Promise<{ stdout: string; stderr: string; code: number | null }>
}

function limitBuffer(): { push: (chunk: Buffer | string) => void; text: () => string } {
  let value = ''
  return {
    push(chunk) {
      value += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (value.length > MAX_STREAM_BYTES) {
        value = value.slice(value.length - MAX_STREAM_BYTES)
      }
    },
    text: () => value
  }
}

export function killProcessTree(child: ChildProcess): void {
  if (!child.pid || child.killed) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    return
  }
  try {
    process.kill(child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // already exited
    }
  }
}

function spawnYtdlp(binary: string, args: string[]): SpawnedJob {
  const child = spawn(binary, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1'
    }
  })
  const stdout = limitBuffer()
  const stderr = limitBuffer()
  child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))

  const wait = new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ stdout: stdout.text(), stderr: stderr.text(), code })
    })
  })

  return { child, wait }
}

export async function analyzeWithEngine(
  binary: string,
  url: string,
  ffmpegAvailable: boolean,
  signal?: AbortSignal
): Promise<MediaAnalysis> {
  const { child, wait } = spawnYtdlp(binary, buildAnalyzeArgs({ url }))
  const onAbort = (): void => killProcessTree(child)
  signal?.addEventListener('abort', onAbort, { once: true })

  const timer = setTimeout(() => {
    killProcessTree(child)
  }, ANALYZE_TIMEOUT_MS)

  try {
    const result = await wait
    if (signal?.aborted) throw new Error('Analysis cancelled')
    if (result.code !== 0) {
      throw new Error(mapEngineError(result.stderr || result.stdout, result.code))
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      throw new Error('The media engine did not return structured information for this URL.')
    }
    const info = parseYtdlpInfo(parsed)
    if (!info) throw new Error('The media engine returned incomplete information.')
    const analysis = buildMediaAnalysis(info, url, ffmpegAvailable)
    if ('error' in analysis) throw new Error(analysis.error)
    return analysis
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function downloadWithEngine(options: {
  binary: string
  url: string
  mode: 'audio' | 'video'
  formatId: string
  outputTemplate: string
  expectedPath: string
  isConversion: boolean
  outputExt: string
  ffmpegPath?: string
  audioQuality?: '0' | '5'
  signal?: AbortSignal
  onProgress?: (progress: EngineProgress) => void
}): Promise<DownloadEngineRun> {
  const args = buildDownloadArgs({
    url: options.url,
    mode: options.mode,
    formatId: options.formatId,
    outputTemplate: options.outputTemplate,
    isConversion: options.isConversion,
    outputExt: options.outputExt,
    ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
    ...(options.audioQuality ? { audioQuality: options.audioQuality } : {})
  })

  const { child, wait } = spawnYtdlp(options.binary, args)
  const onAbort = (): void => killProcessTree(child)
  options.signal?.addEventListener('abort', onAbort, { once: true })

  let lastProgressAt = Date.now()
  const stallTimer = setInterval(() => {
    if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
      killProcessTree(child)
    }
  }, 30_000)

  const watchProgress = (chunk: Buffer): void => {
    const text = chunk.toString('utf8')
    for (const line of text.split(/\r?\n/)) {
      const progress = parseDownloadProgress(line)
      if (progress) {
        lastProgressAt = Date.now()
        options.onProgress?.(progress)
      }
      if (line.includes('[ExtractAudio]') || line.includes('[Merger]')) {
        lastProgressAt = Date.now()
        options.onProgress?.({ percent: 99 })
      }
    }
  }
  child.stdout?.on('data', watchProgress)
  child.stderr?.on('data', watchProgress)

  try {
    const result = await wait
    if (options.signal?.aborted) throw new Error('Download cancelled')
    if (result.code !== 0) {
      throw new Error(mapEngineError(result.stderr || result.stdout, result.code))
    }

    const outputPath = resolveOutputPath(options.expectedPath, options.outputExt, result.stdout)
    if (!outputPath || !existsSync(outputPath)) {
      throw new Error('Download finished but the output file was not found.')
    }
    return { outputPath }
  } finally {
    clearInterval(stallTimer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

function resolveOutputPath(expectedPath: string, outputExt: string, stdout: string): string | null {
  if (existsSync(expectedPath)) return expectedPath
  const dest = stdout.match(/Destination:\s+(.+)$/m)?.[1]?.trim()
  if (dest && existsSync(dest)) return dest
  const altExts = [outputExt, 'mp3', 'm4a', 'wav', 'mp4', 'webm', 'mkv']
  const stem = expectedPath.replace(/\.[^.]+$/, '')
  for (const ext of altExts) {
    const candidate = `${stem}.${ext.replace(/^\./, '')}`
    if (existsSync(candidate)) return candidate
  }
  return existsSync(expectedPath) ? expectedPath : null
}

export async function cleanupDownloadArtifacts(outputPath: string, extraDir?: string): Promise<void> {
  const targets = [
    ...tempSidecars(outputPath),
    ...(extraDir ? tempSidecars(join(extraDir, 'incomplete')) : [])
  ]
  for (const target of targets) {
    try {
      if (existsSync(target)) await unlink(target)
    } catch {
      // ignore cleanup races
    }
  }
}
