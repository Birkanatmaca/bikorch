import { open } from 'fs/promises'

export type AudioKind = 'mp3' | 'm4a' | 'wav' | 'flac' | 'webm' | 'ogg' | 'unknown'

export function sniffAudioKind(header: Buffer): AudioKind {
  if (header.length >= 3 && header.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3'
  if (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0) return 'mp3'
  if (header.length >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp') return 'm4a'
  if (header.length >= 4 && header.subarray(0, 4).toString('ascii') === 'RIFF') return 'wav'
  if (header.length >= 4 && header.subarray(0, 4).toString('ascii') === 'fLaC') return 'flac'
  if (header.length >= 4 && header[0] === 0x1a && header[1] === 0x45) return 'webm'
  if (header.length >= 4 && header.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg'
  return 'unknown'
}

export function isElectronPlayable(kind: AudioKind): boolean {
  return kind === 'mp3' || kind === 'wav' || kind === 'flac' || kind === 'm4a'
}

export function mimeForAudioKind(kind: AudioKind): string {
  if (kind === 'mp3') return 'audio/mpeg'
  if (kind === 'm4a') return 'audio/mp4'
  if (kind === 'wav') return 'audio/wav'
  if (kind === 'flac') return 'audio/flac'
  if (kind === 'ogg') return 'audio/ogg'
  if (kind === 'webm') return 'audio/webm'
  return 'application/octet-stream'
}

export function parseByteRange(
  header: string | null,
  size: number
): { start: number; end: number } | null {
  if (!header || size <= 0) return null
  const match = header.match(/^bytes=(\d*)-(\d*)$/i)
  if (!match) return null
  const start = match[1] ? Number(match[1]) : 0
  const end = match[2] ? Number(match[2]) : size - 1
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end < start || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

export async function sniffAudioFile(filePath: string): Promise<AudioKind> {
  const handle = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(16)
    const { bytesRead } = await handle.read(header, 0, 16, 0)
    return sniffAudioKind(header.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}
