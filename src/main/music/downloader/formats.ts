import type { DownloadMode, MediaAnalysis, MediaFormatOption } from '@shared/contracts/downloads'

export interface RawYtdlpFormat {
  format_id?: string
  ext?: string
  acodec?: string
  vcodec?: string
  abr?: number
  tbr?: number
  height?: number
  width?: number
  filesize?: number
  filesize_approx?: number
  protocol?: string
  format_note?: string
}

export interface RawYtdlpInfo {
  _type?: string
  id?: string
  title?: string
  uploader?: string
  channel?: string
  creator?: string
  duration?: number
  thumbnail?: string
  webpage_url?: string
  original_url?: string
  extractor?: string
  extractor_key?: string
  formats?: RawYtdlpFormat[]
  requested_downloads?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function codecName(raw: string | undefined): string | undefined {
  if (!raw || raw === 'none') return undefined
  return raw.split('.')[0]
}

function filesizeOf(format: RawYtdlpFormat): number | undefined {
  return num(format.filesize) ?? num(format.filesize_approx)
}

function isStoryboard(format: RawYtdlpFormat): boolean {
  const protocol = (format.protocol ?? '').toLowerCase()
  const note = (format.format_note ?? '').toLowerCase()
  return protocol.includes('mhtml') || note.includes('storyboard')
}

function parseFormat(raw: unknown): RawYtdlpFormat | null {
  if (!isRecord(raw)) return null
  const formatId = text(raw['format_id'])
  if (!formatId) return null
  return {
    format_id: formatId,
    ext: text(raw['ext']),
    acodec: text(raw['acodec']),
    vcodec: text(raw['vcodec']),
    abr: num(raw['abr']),
    tbr: num(raw['tbr']),
    height: num(raw['height']),
    width: num(raw['width']),
    filesize: num(raw['filesize']),
    filesize_approx: num(raw['filesize_approx']),
    protocol: text(raw['protocol']),
    format_note: text(raw['format_note'])
  }
}

export function parseYtdlpInfo(raw: unknown): RawYtdlpInfo | null {
  if (!isRecord(raw)) return null
  const formats = Array.isArray(raw['formats'])
    ? raw['formats'].map(parseFormat).filter((item): item is RawYtdlpFormat => Boolean(item))
    : []
  return {
    _type: text(raw['_type']),
    id: text(raw['id']),
    title: text(raw['title']),
    uploader: text(raw['uploader']),
    channel: text(raw['channel']),
    creator: text(raw['creator']),
    duration: num(raw['duration']),
    thumbnail: text(raw['thumbnail']),
    webpage_url: text(raw['webpage_url']),
    original_url: text(raw['original_url']),
    extractor: text(raw['extractor']),
    extractor_key: text(raw['extractor_key']),
    formats
  }
}

export const BEST_AUDIO_SELECTOR = 'ba/bestaudio/best'

function audioOptions(formats: RawYtdlpFormat[], ffmpegAvailable: boolean): MediaFormatOption[] {
  const audio = formats.filter((format) => {
    if (isStoryboard(format)) return false
    const hasAudio = format.acodec && format.acodec !== 'none'
    const noVideo = !format.vcodec || format.vcodec === 'none'
    return Boolean(hasAudio && noVideo)
  })

  const playableExt = new Set(['m4a', 'aac', 'mp3', 'wav', 'flac'])
  const sorted = [...audio].sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))
  if (ffmpegAvailable) {
    return [
      {
        id: BEST_AUDIO_SELECTOR,
        mode: 'audio',
        ext: 'mp3',
        label: 'MP3 · plays in Bikorch',
        qualityNote: 'Always saved as MP3 so the Player can decode it.',
        isConversion: true,
        ...(sorted[0]?.format_id ? { sourceFormatId: sorted[0].format_id } : {})
      }
    ]
  }

  return sorted
    .filter((format) => playableExt.has((format.ext ?? '').toLowerCase()))
    .slice(0, 4)
    .map((format) => {
      const ext = (format.ext ?? 'm4a').toLowerCase()
      const bitrate = format.abr ?? format.tbr
      return {
        id: format.format_id ?? ext,
        mode: 'audio' as const,
        ext,
        label: bitrate ? `${ext.toUpperCase()} · ${Math.round(bitrate)} kbps` : ext.toUpperCase(),
        ...(codecName(format.acodec) ? { codec: codecName(format.acodec) } : {}),
        ...(bitrate ? { bitrateKbps: Math.round(bitrate) } : {}),
        ...(filesizeOf(format) ? { filesizeApprox: filesizeOf(format) } : {}),
        isConversion: false
      }
    })
}

function videoOptions(formats: RawYtdlpFormat[], ffmpegAvailable: boolean): MediaFormatOption[] {
  const combined = formats.filter((format) => {
    if (isStoryboard(format)) return false
    return (
      Boolean(format.vcodec && format.vcodec !== 'none') &&
      Boolean(format.acodec && format.acodec !== 'none')
    )
  })

  const options: MediaFormatOption[] = []
  const seenHeights = new Set<number>()
  const sorted = [...combined].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))

  for (const format of sorted) {
    const height = format.height ?? 0
    if (height && seenHeights.has(height)) continue
    if (height) seenHeights.add(height)
    const ext = (format.ext ?? 'mp4').toLowerCase()
    options.push({
      id: format.format_id ?? `${ext}-${height}`,
      mode: 'video',
      ext,
      label: height ? `${ext.toUpperCase()} · ${height}p` : ext.toUpperCase(),
      ...(height ? { resolution: `${height}p` } : {}),
      ...(codecName(format.vcodec) ? { codec: codecName(format.vcodec) } : {}),
      ...(filesizeOf(format) ? { filesizeApprox: filesizeOf(format) } : {}),
      isConversion: false
    })
    if (options.length >= 8) break
  }

  if (ffmpegAvailable) {
    options.unshift({
      id: 'bv*+ba/b',
      mode: 'video',
      ext: 'mp4',
      label: 'MP4 · best available',
      qualityNote: 'Merges the best available video and audio when the engine supports it',
      isConversion: true
    })
  }

  return options
}

export function buildMediaAnalysis(
  info: RawYtdlpInfo,
  sourceUrl: string,
  ffmpegAvailable: boolean
): MediaAnalysis | { error: string } {
  if (info._type === 'playlist') {
    return { error: 'Playlists are not supported. Paste a single media URL.' }
  }

  const formats = info.formats ?? []
  const audioFormats = audioOptions(formats, ffmpegAvailable)
  const videoFormats = videoOptions(formats, ffmpegAvailable)
  if (audioFormats.length === 0 && videoFormats.length === 0) {
    return { error: 'No downloadable audio or video formats were advertised for this source.' }
  }

  const thumbnail = info.thumbnail
  const safeThumb =
    thumbnail && (thumbnail.startsWith('https://') || thumbnail.startsWith('http://'))
      ? thumbnail
      : undefined

  return {
    sourceUrl,
    sourceType: info.extractor_key ?? info.extractor ?? 'generic',
    ...(info.title ? { title: info.title } : {}),
    ...(info.creator || info.uploader || info.channel
      ? { creator: info.creator ?? info.uploader ?? info.channel }
      : {}),
    ...(info.duration ? { durationSec: Math.round(info.duration) } : {}),
    ...(safeThumb ? { thumbnailUrl: safeThumb } : {}),
    ...(info.webpage_url || info.original_url
      ? { webpageUrl: info.webpage_url ?? info.original_url }
      : {}),
    audioFormats,
    videoFormats
  }
}

export function resolveSelectedFormat(
  analysis: MediaAnalysis,
  mode: DownloadMode,
  formatId: string
): MediaFormatOption | null {
  const pool = mode === 'audio' ? analysis.audioFormats : analysis.videoFormats
  return pool.find((item) => item.id === formatId) ?? null
}

export function preferredFormatId(
  analysis: MediaAnalysis,
  mode: DownloadMode,
  _audioPreference: 'm4a' | 'mp3',
  videoPreference: 'best' | '1080' | '720' | '480'
): string | null {
  if (mode === 'audio') {
    return (
      analysis.audioFormats.find((item) => item.id === BEST_AUDIO_SELECTOR)?.id ??
      analysis.audioFormats.find((item) => item.ext === 'mp3' || item.ext === 'm4a')?.id ??
      analysis.audioFormats[0]?.id ??
      null
    )
  }

  if (videoPreference !== 'best') {
    const height = Number(videoPreference)
    const match = analysis.videoFormats.find((item) => item.resolution === `${height}p`)
    if (match) return match.id
  }
  return analysis.videoFormats[0]?.id ?? null
}
