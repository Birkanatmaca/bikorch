import { spawn } from 'child_process'
import { readMetaValue, writeMetaValue } from '../persistence/database'
import { detectDownloadEngine } from './downloader/binaries'
import { installDownloadEngine } from './downloader/service'
import { buildYouTubeSearchTerm, extractYouTubeVideoId, isYouTubeVideoId } from './spotify-youtube-search'

export { buildYouTubeSearchTerm, isYouTubeVideoId } from './spotify-youtube-search'

const SEARCH_TIMEOUT_MS = 45_000

function cacheKey(sourceId: string | undefined, term: string): string {
  return `spotify_yt:${sourceId || term.toLowerCase()}`
}

function parseDumpJson(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error('The media engine returned no search results.')
  try {
    return JSON.parse(trimmed)
  } catch {
    const first = trimmed.split('\n').find((line) => line.trim().startsWith('{'))
    if (!first) throw new Error('The media engine did not return structured information.')
    return JSON.parse(first)
  }
}

async function dumpSearchJson(binary: string, query: string): Promise<unknown> {
  const child = spawn(
    binary,
    [
      '--dump-single-json',
      '--flat-playlist',
      '--skip-download',
      '--no-warnings',
      '--ignore-config',
      '--no-cache-dir',
      '--no-mtime',
      '--no-call-home',
      '--',
      query
    ],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1'
      }
    }
  )

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
    if (stdout.length > 2 * 1024 * 1024) stdout = stdout.slice(-2 * 1024 * 1024)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  return await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('YouTube search timed out'))
    }, SEARCH_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || 'YouTube search failed'))
        return
      }
      try {
        resolve(parseDumpJson(stdout))
      } catch (error) {
        reject(error)
      }
    })
  })
}

export async function resolveSpotifyPlayback(input: {
  title: string
  artist?: string
  sourceId?: string
}): Promise<{ ok: true; videoId: string; title?: string } | { ok: false; error: string }> {
  const title = input.title.trim()
  if (!title) return { ok: false, error: 'Missing track title' }
  const term = buildYouTubeSearchTerm(input.artist, title)
  if (!term) return { ok: false, error: 'Could not build a search' }

  const cached = readMetaValue(cacheKey(input.sourceId, term))
  if (cached && isYouTubeVideoId(cached)) {
    console.log('[spotify] youtube cache hit', cached)
    return { ok: true, videoId: cached }
  }

  let engine = await detectDownloadEngine()
  if (!engine.ytDlp.available) {
    const installed = await installDownloadEngine()
    engine = installed.engine
  }
  const binary = engine.ytDlp.path
  if (!binary) return { ok: false, error: 'Downloader is not ready yet. Try again in a moment.' }

  const query = `ytsearch1:${term}`
  console.log('[spotify] youtube search', term)
  try {
    const dumped = await dumpSearchJson(binary, query)
    const videoId = extractYouTubeVideoId(dumped)
    if (!videoId) {
      console.log('[spotify] youtube search missed')
      return { ok: false, error: 'No matching YouTube audio was found for this track.' }
    }
    const dumpedTitle =
      dumped && typeof dumped === 'object' && !Array.isArray(dumped)
        ? typeof (dumped as { title?: unknown }).title === 'string'
          ? (dumped as { title: string }).title
          : undefined
        : undefined
    writeMetaValue(cacheKey(input.sourceId, term), videoId)
    console.log('[spotify] youtube resolved', videoId, dumpedTitle ?? '')
    return { ok: true, videoId, ...(dumpedTitle ? { title: dumpedTitle } : {}) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'YouTube search failed'
    console.log('[spotify] youtube search failed', message)
    return { ok: false, error: message }
  }
}
