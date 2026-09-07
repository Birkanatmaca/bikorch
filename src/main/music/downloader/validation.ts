import type {
  DownloadMode,
  DownloadRequest,
  DownloadSettings
} from '@shared/contracts/downloads'
import { validateDownloadUrl } from './url-safety'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined
}

export function parseAnalyzeUrl(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const result = validateDownloadUrl(payload)
    return result.ok ? result.url : null
  }
  if (!isRecord(payload)) return null
  const raw = payload['sourceUrl'] ?? payload['url']
  if (typeof raw !== 'string') return null
  const result = validateDownloadUrl(raw)
  return result.ok ? result.url : null
}

export function parseDownloadRequest(payload: unknown): DownloadRequest | null {
  if (!isRecord(payload)) return null
  const urlResult = typeof payload['sourceUrl'] === 'string' ? validateDownloadUrl(payload['sourceUrl']) : null
  if (!urlResult?.ok) return null
  const mode: DownloadMode | null = payload['mode'] === 'audio' || payload['mode'] === 'video' ? payload['mode'] : null
  const formatId = optionalId(payload['formatId'])
  const outputExt =
    typeof payload['outputExt'] === 'string' ? payload['outputExt'].replace(/^\./, '').toLowerCase().slice(0, 8) : ''
  if (!mode || !formatId || !outputExt) return null
  if (!/^[a-z0-9]+$/.test(outputExt)) return null
  if (payload['destinationId'] !== undefined && payload['destinationId'] !== 'default' && payload['destinationId'] !== 'custom') {
    return null
  }
  return {
    sourceUrl: urlResult.url,
    mode,
    formatId,
    outputExt,
    isConversion: payload['isConversion'] === true,
    destinationId: payload['destinationId'] === 'custom' ? 'custom' : 'default',
    importToLibrary: payload['importToLibrary'] === true,
    ...(optionalId(payload['playlistId']) ? { playlistId: optionalId(payload['playlistId']) } : {})
  }
}

export function parseAnalysisPreview(
  payload: unknown
): { title?: string; creator?: string; sourceType: string } | undefined {
  if (!isRecord(payload)) return undefined
  const analysis = isRecord(payload['analysis']) ? payload['analysis'] : payload
  const title = typeof analysis['title'] === 'string' ? analysis['title'].trim().slice(0, 200) : undefined
  const creator = typeof analysis['creator'] === 'string' ? analysis['creator'].trim().slice(0, 200) : undefined
  const sourceType =
    typeof analysis['sourceType'] === 'string' ? analysis['sourceType'].trim().slice(0, 80) : undefined
  if (!title && !creator && !sourceType) return undefined
  return {
    ...(title ? { title } : {}),
    ...(creator ? { creator } : {}),
    sourceType: sourceType ?? 'generic'
  }
}

export function parseJobId(payload: unknown): string | null {
  if (typeof payload === 'string') return optionalId(payload) ?? null
  if (!isRecord(payload)) return null
  return optionalId(payload['jobId'] ?? payload['id']) ?? null
}

export function parseDownloadSettingsUpdate(payload: unknown): Partial<DownloadSettings> | null {
  if (!isRecord(payload)) return null
  const updates: Partial<DownloadSettings> = {}
  if (payload['defaultAudioFormat'] === 'mp3' || payload['defaultAudioFormat'] === 'm4a') {
    updates.defaultAudioFormat = payload['defaultAudioFormat']
  }
  if (payload['defaultAudioQuality'] === 'high' || payload['defaultAudioQuality'] === 'standard') {
    updates.defaultAudioQuality = payload['defaultAudioQuality']
  }
  if (
    payload['defaultVideoQuality'] === 'best' ||
    payload['defaultVideoQuality'] === '1080' ||
    payload['defaultVideoQuality'] === '720' ||
    payload['defaultVideoQuality'] === '480'
  ) {
    updates.defaultVideoQuality = payload['defaultVideoQuality']
  }
  if (payload['maxConcurrentDownloads'] === 1 || payload['maxConcurrentDownloads'] === 2) {
    updates.maxConcurrentDownloads = payload['maxConcurrentDownloads']
  }
  if (typeof payload['keepHistory'] === 'boolean') updates.keepHistory = payload['keepHistory']
  return Object.keys(updates).length > 0 ? updates : {}
}
