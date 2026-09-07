import type { DownloadMode } from '@shared/contracts/downloads'

export interface AnalyzeArgOptions {
  url: string
}

export interface DownloadArgOptions {
  url: string
  mode: DownloadMode
  formatId: string
  outputTemplate: string
  isConversion: boolean
  outputExt: string
  ffmpegPath?: string
  audioQuality?: '0' | '5'
}

function assertSafeToken(value: string, label: string): string {
  if (!value || typeof value !== 'string') throw new Error(`Missing ${label}`)
  if (value.includes('\0')) throw new Error(`Invalid ${label}`)
  return value
}

export function buildAnalyzeArgs(options: AnalyzeArgOptions): string[] {
  const url = assertSafeToken(options.url, 'url')
  return [
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    '--skip-download',
    '--ignore-config',
    '--no-cache-dir',
    '--no-mtime',
    '--no-call-home',
    '--',
    url
  ]
}

export function buildDownloadArgs(options: DownloadArgOptions): string[] {
  const url = assertSafeToken(options.url, 'url')
  const formatId = assertSafeToken(options.formatId, 'format')
  const outputTemplate = assertSafeToken(options.outputTemplate, 'output')
  if (formatId.startsWith('-') && formatId !== 'bv*+ba/b') {
    throw new Error('Invalid format selector')
  }
  if (formatId.includes('\n') || formatId.includes('"') || formatId.includes("'")) {
    throw new Error('Invalid format selector')
  }

  const args = [
    '--no-playlist',
    '--ignore-config',
    '--no-cache-dir',
    '--newline',
    '--no-mtime',
    '--no-call-home',
    '--restrict-filenames',
    '-o',
    outputTemplate
  ]

  if (options.ffmpegPath) {
    args.push('--ffmpeg-location', assertSafeToken(options.ffmpegPath, 'ffmpeg'))
  }

  if (options.mode === 'audio') {
    if (options.isConversion) {
      const ext = options.outputExt.replace(/^\./, '').toLowerCase()
      if (!['mp3', 'm4a', 'wav'].includes(ext)) {
        throw new Error('Unsupported conversion format')
      }
      const sourceId = formatId.startsWith('convert:')
        ? formatId.split(':').slice(2).join(':')
        : formatId
      args.push(
        '-f',
        sourceId,
        '-x',
        '--audio-format',
        ext,
        '--audio-quality',
        options.audioQuality === '5' ? '5' : '0',
        '--add-metadata',
        '--write-thumbnail'
      )
    } else {
      args.push('-f', formatId)
    }
  } else if (options.isConversion && formatId === 'bv*+ba/b') {
    args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4')
  } else {
    args.push('-f', formatId)
    if (options.outputExt.replace(/^\./, '').toLowerCase() === 'mp4') {
      args.push('--merge-output-format', 'mp4')
    }
  }

  args.push('--', url)
  return args
}

export function parseDownloadProgress(line: string): {
  percent?: number
  speedBytesPerSec?: number
  etaSec?: number
} | null {
  const match = line.match(
    /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?[\d.]+(?:[KMG]i?B)\s+at\s+([\d.]+)([KMG])i?B\/s(?:\s+ETA\s+(\d+):(\d+)(?::(\d+))?)?/i
  )
  if (!match) {
    const simple = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
    if (!simple) return null
    return { percent: Math.min(100, Number(simple[1])) }
  }

  const percent = Math.min(100, Number(match[1]))
  const speedValue = Number(match[2])
  const unit = match[3].toUpperCase()
  const multiplier = unit === 'G' ? 1024 ** 3 : unit === 'M' ? 1024 ** 2 : 1024
  const speedBytesPerSec = Number.isFinite(speedValue) ? Math.round(speedValue * multiplier) : undefined

  let etaSec: number | undefined
  if (match[4] && match[5]) {
    if (match[6]) {
      etaSec = Number(match[4]) * 3600 + Number(match[5]) * 60 + Number(match[6])
    } else {
      etaSec = Number(match[4]) * 60 + Number(match[5])
    }
  }

  return {
    percent,
    ...(speedBytesPerSec !== undefined ? { speedBytesPerSec } : {}),
    ...(etaSec !== undefined ? { etaSec } : {})
  }
}

export const DOWNLOAD_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['analyzing', 'downloading', 'cancelled', 'failed'],
  analyzing: ['pending', 'downloading', 'failed', 'cancelled'],
  downloading: ['processing', 'failed', 'cancelled'],
  processing: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: ['pending'],
  cancelled: ['pending']
}

export function canTransitionStatus(from: string, to: string): boolean {
  return (DOWNLOAD_STATUS_TRANSITIONS[from] ?? []).includes(to)
}
