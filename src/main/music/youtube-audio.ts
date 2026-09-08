import { spawn } from 'child_process'
import { net } from 'electron'
import { detectDownloadEngine } from './downloader/binaries'
import { installDownloadEngine } from './downloader/service'
import { getMusicStore } from './store'
import { buildYouTubeAudioUrlArgs } from './youtube-audio-args'

export { buildYouTubeAudioUrlArgs } from './youtube-audio-args'

const CACHE_MS = 12 * 60 * 1000
const RESOLVE_TIMEOUT_MS = 18_000
const cache = new Map<string, { url: string; at: number }>()
const inflight = new Map<string, Promise<string>>()

async function ytDlpBinary(): Promise<string | null> {
  let engine = await detectDownloadEngine()
  if (!engine.ytDlp.available) {
    const installed = await installDownloadEngine()
    engine = installed.engine
  }
  return engine.ytDlp.path ?? null
}

function spawnGetUrl(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('YouTube audio timed out'))
    }, RESOLVE_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const line = stdout
        .split('\n')
        .map((item) => item.trim())
        .find((item) => item.startsWith('https://'))
      if (code === 0 && line) {
        resolve(line)
        return
      }
      reject(new Error(stderr.trim() || 'Could not open this YouTube song.'))
    })
  })
}

async function resolveFresh(sourceUrl: string): Promise<string> {
  const binary = await ytDlpBinary()
  if (!binary) throw new Error('YouTube audio is not ready yet.')
  try {
    return await spawnGetUrl(binary, buildYouTubeAudioUrlArgs(sourceUrl, true))
  } catch {
    return await spawnGetUrl(binary, buildYouTubeAudioUrlArgs(sourceUrl, false))
  }
}

export function invalidateYouTubeAudioCache(sourceUrl: string): void {
  cache.delete(sourceUrl)
  inflight.delete(sourceUrl)
}

export async function resolveYouTubeAudioUrl(sourceUrl: string): Promise<string> {
  const cached = cache.get(sourceUrl)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.url

  const pending = inflight.get(sourceUrl)
  if (pending) return pending

  const next = resolveFresh(sourceUrl)
    .then((url) => {
      cache.set(sourceUrl, { url, at: Date.now() })
      return url
    })
    .finally(() => {
      inflight.delete(sourceUrl)
    })
  inflight.set(sourceUrl, next)
  return next
}

async function fetchYouTubeMedia(audioUrl: string, request: Request): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: '*/*',
    Referer: 'https://www.youtube.com/',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  }
  const range = request.headers.get('Range') ?? request.headers.get('range')
  if (range) headers.Range = range
  return net.fetch(audioUrl, { headers, redirect: 'follow' })
}

export async function serveYouTubeAudio(trackId: string, request: Request): Promise<Response> {
  const track = getMusicStore()?.getTrack(trackId)
  if (!track || track.source !== 'youtube' || !track.sourceUrl) {
    return new Response('Not found', { status: 404 })
  }

  let audioUrl = await resolveYouTubeAudioUrl(track.sourceUrl)
  let response = await fetchYouTubeMedia(audioUrl, request)
  if (response.status === 403 || response.status === 410) {
    invalidateYouTubeAudioCache(track.sourceUrl)
    audioUrl = await resolveYouTubeAudioUrl(track.sourceUrl)
    response = await fetchYouTubeMedia(audioUrl, request)
  }

  const out = new Headers()
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = response.headers.get(key)
    if (value) out.set(key, value)
  }
  if (!out.has('content-type')) out.set('Content-Type', 'audio/mp4')
  out.set('Access-Control-Allow-Origin', '*')
  out.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
  out.set('Cache-Control', 'no-store')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: out
  })
}
