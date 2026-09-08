import { spawn } from 'child_process'
import { detectDownloadEngine } from './downloader/binaries'
import { installDownloadEngine } from './downloader/service'
import {
  extractYouTubeSearchHits,
  sanitizeYouTubeSearchQuery,
  type YouTubeSearchHit
} from './youtube-ids'

export type { YouTubeSearchHit } from './youtube-ids'

const SEARCH_TIMEOUT_MS = 45_000

function parseDumpJson(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error('YouTube search returned no results.')
  try {
    return JSON.parse(trimmed)
  } catch {
    const objects = trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{'))
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown]
        } catch {
          return []
        }
      })
    if (objects.length === 0) throw new Error('YouTube search did not return structured results.')
    return objects
  }
}

async function dumpSearchJson(binary: string, query: string, limit: number): Promise<unknown> {
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
      '--',
      `ytsearch${limit}:${query}`
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
    if (stdout.length > 4 * 1024 * 1024) stdout = stdout.slice(-4 * 1024 * 1024)
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

export async function searchYouTubeVideos(
  rawQuery: string,
  limit = 3
): Promise<{ ok: true; items: YouTubeSearchHit[] } | { ok: false; error: string }> {
  const query = sanitizeYouTubeSearchQuery(rawQuery)
  if (!query) return { ok: false, error: 'Type at least two characters to search YouTube.' }

  const safeLimit = Math.min(12, Math.max(3, Math.round(limit)))
  let engine = await detectDownloadEngine()
  if (!engine.ytDlp.available) {
    const installed = await installDownloadEngine()
    engine = installed.engine
    if (!engine.ytDlp.available) {
      return {
        ok: false,
        error: installed.error ?? 'YouTube search needs yt-dlp. Try searching again in a moment.'
      }
    }
  }
  const binary = engine.ytDlp.path
  if (!binary) return { ok: false, error: 'YouTube search needs yt-dlp. Try searching again in a moment.' }

  try {
    const dumped = await dumpSearchJson(binary, query, safeLimit)
    const items = extractYouTubeSearchHits(dumped, safeLimit)
    if (items.length === 0) return { ok: false, error: 'No YouTube videos matched that search.' }
    return { ok: true, items }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'YouTube search failed'
    }
  }
}
