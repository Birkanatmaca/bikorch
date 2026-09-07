import { copyFile, unlink, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { extname, join } from 'path'
import { validateDownloadUrl } from './downloader/url-safety'
import { parseMusicUrl } from './url-parser'

export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const

export function isYoutubeVideoId(value: string | undefined): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]{11}$/.test(value))
}

export function youtubeArtworkUrls(videoId: string): string[] {
  if (!isYoutubeVideoId(videoId)) return []
  return [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  ]
}

export function sniffImageKind(header: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'jpeg'
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47
  ) {
    return 'png'
  }
  if (
    header.length >= 12 &&
    header.subarray(0, 4).toString('ascii') === 'RIFF' &&
    header.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

export function findSidecarThumbnail(audioPath: string): string | null {
  const stem = audioPath.slice(0, audioPath.length - extname(audioPath).length)
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = `${stem}${ext}`
    if (existsSync(candidate)) return candidate
  }
  return null
}

function extensionForKind(kind: 'jpeg' | 'png' | 'webp'): string {
  if (kind === 'png') return '.png'
  if (kind === 'webp') return '.webp'
  return '.jpg'
}

async function fetchImageBytes(url: string): Promise<{ bytes: Buffer; ext: string } | null> {
  const safe = validateDownloadUrl(url)
  if (!safe.ok) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(safe.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'image/jpeg,image/png,image/webp,image/*' }
    })
    if (!response.ok) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength < 64 || bytes.byteLength > 2_500_000) return null
    const kind = sniffImageKind(bytes)
    if (!kind) return null
    return { bytes, ext: extensionForKind(kind) }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function writeArtworkFile(trackId: string, bytes: Buffer, ext: string): Promise<string> {
  const { artworkDir } = await import('./paths')
  const destination = join(artworkDir(), `${trackId}${ext}`)
  await writeFile(destination, bytes)
  return destination
}

export async function importSidecarArtwork(trackId: string, audioPath: string): Promise<string | null> {
  const sidecar = findSidecarThumbnail(audioPath)
  if (!sidecar) return null
  try {
    const { artworkDir } = await import('./paths')
    const ext = extname(sidecar).toLowerCase() === '.jpeg' ? '.jpg' : extname(sidecar).toLowerCase()
    const destination = join(artworkDir(), `${trackId}${ext}`)
    await copyFile(sidecar, destination)
    try {
      await unlink(sidecar)
    } catch {
      // keep the sidecar if it cannot be removed
    }
    return destination
  } catch {
    return null
  }
}

export async function downloadRemoteArtwork(trackId: string, urls: string[]): Promise<string | null> {
  for (const url of urls) {
    const image = await fetchImageBytes(url)
    if (!image) continue
    try {
      return await writeArtworkFile(trackId, image.bytes, image.ext)
    } catch {
      // try the next candidate
    }
  }
  return null
}

export function artworkCandidatesForSource(sourceUrl?: string, sourceId?: string): string[] {
  const parsed = sourceUrl ? parseMusicUrl(sourceUrl) : null
  const videoId = parsed?.source === 'youtube' ? parsed.sourceId : sourceId
  return youtubeArtworkUrls(videoId ?? '')
}

export async function ensureTrackArtwork(trackId: string, sidecarFrom?: string): Promise<string | null> {
  const { getMusicStore } = await import('./store')
  const store = getMusicStore()
  const track = store?.getTrack(trackId)
  if (!store || !track) return null

  if (track.artworkPath && !/^https?:\/\//i.test(track.artworkPath) && existsSync(track.artworkPath)) {
    return track.artworkPath
  }

  let saved: string | null = null
  if (sidecarFrom) {
    saved = await importSidecarArtwork(trackId, sidecarFrom)
  }
  if (!saved && track.filePath) {
    saved = await importSidecarArtwork(trackId, track.filePath)
  }
  if (!saved && track.artworkPath && /^https?:\/\//i.test(track.artworkPath)) {
    saved = await downloadRemoteArtwork(trackId, [track.artworkPath])
  }
  if (!saved) {
    saved = await downloadRemoteArtwork(trackId, artworkCandidatesForSource(track.sourceUrl, track.sourceId))
  }
  if (!saved) return null

  store.updateTrackArtwork(trackId, saved)
  return saved
}
