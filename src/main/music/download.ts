import { randomUUID } from 'crypto'
import { createWriteStream, existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { basename, extname, join } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { AddLinkResult, MusicTrack } from '@shared/contracts/music'
import { MUSIC_AUDIO_EXTENSIONS } from '@shared/contracts/music'
import { metadataFromFilename } from './metadata'
import { managedLibraryDir } from './paths'
import { getMusicStore } from './store'
import { parseDirectAudioUrl } from './url-parser'

const MAX_BYTES = 100 * 1024 * 1024

function canonicalPath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

function isAudioContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase()
  return lower.startsWith('audio/') || lower.includes('application/octet-stream')
}

export async function downloadDirectAudio(url: string): Promise<AddLinkResult> {
  const directUrl = parseDirectAudioUrl(url)
  if (!directUrl) {
    return {
      ok: false,
      error: 'Direct download requires a public link ending in .mp3, .wav, .flac, or similar.'
    }
  }

  const store = getMusicStore()
  if (!store) return { ok: false, error: 'Database is not ready' }

  const previous = store.listTracks().find((track) => track.sourceUrl === directUrl &&
    track.filePath && existsSync(track.filePath))
  if (previous) return { ok: true, track: previous, duplicate: true }

  const parsed = new URL(directUrl)
  const ext = extname(parsed.pathname).toLowerCase()
  if (!MUSIC_AUDIO_EXTENSIONS.has(ext)) {
    return { ok: false, error: 'Unsupported audio format in URL.' }
  }

  let response: Response
  try {
    response = await fetch(directUrl, { redirect: 'follow' })
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not reach download URL'
    }
  }

  if (!response.ok) {
    return { ok: false, error: `Download failed (HTTP ${response.status})` }
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType && !isAudioContentType(contentType)) {
    return {
      ok: false,
      error: 'URL did not return audio content. Use a direct link to an audio file.'
    }
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BYTES) {
    return { ok: false, error: 'File is too large (max 100 MB).' }
  }

  const id = randomUUID()
  const destination = join(managedLibraryDir(), `${id}${ext}`)
  if (!response.body) return { ok: false, error: 'Downloaded file is empty' }
  let received = 0
  try {
    await pipeline(
      Readable.fromWeb(response.body as import('stream/web').ReadableStream),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length
          callback(received > MAX_BYTES ? new Error('File is too large (max 100 MB).') : null, chunk)
        }
      }),
      createWriteStream(destination, { flags: 'wx' })
    )
    if (received === 0) throw new Error('Downloaded file is empty')
  } catch (error) {
    await unlink(destination).catch(() => undefined)
    return { ok: false, error: error instanceof Error ? error.message : 'Download failed' }
  }

  const canonical = canonicalPath(destination)
  const filename = basename(parsed.pathname) || `download${ext}`
  const meta = metadataFromFilename(filename)
  const track: MusicTrack = {
    id,
    title: meta.title,
    ...(meta.artist ? { artist: meta.artist } : {}),
    filePath: destination,
    source: 'local',
    sourceUrl: directUrl,
    isOfflineAvailable: true,
    storageMode: 'managed',
    addedAt: Date.now(),
    playCount: 0
  }

  store.upsertTrack(track, canonical)
  return { ok: true, track, duplicate: false }
}
