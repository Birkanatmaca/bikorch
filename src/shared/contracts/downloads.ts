export type DownloadStatus =
  | 'pending'
  | 'analyzing'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type DownloadMode = 'audio' | 'video'
export type DownloadDestinationId = 'default' | 'custom'
export type DownloadAudioFormat = 'm4a' | 'mp3'
export type DownloadAudioQuality = 'high' | 'standard'
export type DownloadVideoQuality = 'best' | '1080' | '720' | '480'

export interface DownloadSettings {
  defaultFolder: string | null
  defaultAudioFormat: DownloadAudioFormat
  defaultAudioQuality: DownloadAudioQuality
  defaultVideoQuality: DownloadVideoQuality
  importAudioToLibrary: boolean
  maxConcurrentDownloads: 1 | 2
  keepHistory: boolean
}

export interface MediaFormatOption {
  id: string
  mode: DownloadMode
  ext: string
  label: string
  qualityNote?: string
  resolution?: string
  codec?: string
  bitrateKbps?: number
  filesizeApprox?: number
  isConversion: boolean
  sourceFormatId?: string
}

export interface MediaAnalysis {
  sourceUrl: string
  sourceType: string
  title?: string
  creator?: string
  durationSec?: number
  thumbnailUrl?: string
  webpageUrl?: string
  audioFormats: MediaFormatOption[]
  videoFormats: MediaFormatOption[]
  warning?: string
}

export interface DownloadRequest {
  sourceUrl: string
  mode: DownloadMode
  formatId: string
  outputExt: string
  isConversion: boolean
  destinationId: DownloadDestinationId
  importToLibrary: boolean
  playlistId?: string
}

export interface DownloadJob {
  id: string
  sourceUrl: string
  sourceType?: string
  title?: string
  creator?: string
  mode: DownloadMode
  format: string
  quality?: string
  status: DownloadStatus
  destination: string
  outputPath?: string
  progress?: number
  speedBytesPerSec?: number
  etaSec?: number
  error?: string
  trackId?: string
  importToLibrary: boolean
  playlistId?: string
  formatId: string
  outputExt: string
  isConversion: boolean
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface BinaryPresence {
  available: boolean
  path?: string
  version?: string
}

export interface DownloadEngineStatus {
  ytDlp: BinaryPresence
  ffmpeg: BinaryPresence
  setupHint: string
}

export interface EngineInstallResult {
  ok: boolean
  error?: string
  engine: DownloadEngineStatus
}

export interface DownloadEvent {
  type: 'updated' | 'removed'
  job?: DownloadJob
}

export interface AnalyzeResult {
  ok: boolean
  analysis?: MediaAnalysis
  error?: string
}

export interface StartDownloadResult {
  ok: boolean
  job?: DownloadJob
  error?: string
}

export function createDefaultDownloadSettings(): DownloadSettings {
  return {
    defaultFolder: null,
    defaultAudioFormat: 'mp3',
    defaultAudioQuality: 'high',
    defaultVideoQuality: 'best',
    importAudioToLibrary: true,
    maxConcurrentDownloads: 1,
    keepHistory: true
  }
}

export const ACTIVE_DOWNLOAD_STATUSES: readonly DownloadStatus[] = [
  'pending',
  'analyzing',
  'downloading',
  'processing'
]

export const TERMINAL_DOWNLOAD_STATUSES: readonly DownloadStatus[] = [
  'completed',
  'failed',
  'cancelled'
]

export const DOWNLOAD_SCHEMA_VERSION = 1

export const MUSIC_DOWNLOAD_IPC = {
  ENGINE_STATUS: 'music:download:engine-status',
  ENGINE_INSTALL: 'music:download:engine-install',
  ANALYZE: 'music:download:analyze',
  START: 'music:download:start',
  LIST: 'music:download:list',
  CANCEL: 'music:download:cancel',
  RETRY: 'music:download:retry',
  CLEAR_HISTORY: 'music:download:clear-history',
  GET_SETTINGS: 'music:download:get-settings',
  UPDATE_SETTINGS: 'music:download:update-settings',
  PICK_FOLDER: 'music:download:pick-folder',
  OPEN_FILE: 'music:download:open-file',
  OPEN_FOLDER: 'music:download:open-folder',
  OPEN_DIR: 'music:download:open-dir',
  COPY_PATH: 'music:download:copy-path',
  DELETE: 'music:download:delete',
  EVENT: 'music:download:event'
} as const
