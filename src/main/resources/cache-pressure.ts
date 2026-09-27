import {
  CACHE_WARN_STEPS_MB,
  DEFAULT_CACHE_WARN_MB,
  type CacheAnalysis,
  type CachePart
} from '@shared/contracts/resources'

const BUCKET_BYTES = 64 * 1024 * 1024

export function parseCacheWarnMb(value: unknown): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric)) return DEFAULT_CACHE_WARN_MB
  return CACHE_WARN_STEPS_MB.reduce((closest, step) =>
    Math.abs(step - numeric) < Math.abs(closest - numeric) ? step : closest
  )
}

export function cacheSignature(clearableBytes: number, warnAtMb: number): string {
  return `${warnAtMb}:${Math.floor(Math.max(0, clearableBytes) / BUCKET_BYTES)}`
}

function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`
}

export function localCacheRecommendation(parts: CachePart[]): string {
  const top = [...parts].sort((left, right) => right.bytes - left.bytes).find((part) => part.bytes > 0)
  if (!top) return 'Browser caches are small. Nothing needs to be cleared.'
  return `${top.label} is the largest growing cache at ${megabytes(top.bytes)}. Clearing HTTP and code caches keeps sign-ins, projects, and music, and gives development the space those caches were using.`
}

export function assessCachePressure(input: {
  parts: CachePart[]
  warnAtMb: number
  dismissedSignature: string | null
  recommendation: string | null
  collectedAt: number
  releasedBytes?: number | null
}): CacheAnalysis {
  const warnAtMb = parseCacheWarnMb(input.warnAtMb)
  const parts = input.parts.filter((part) => part.bytes > 0).sort((left, right) => right.bytes - left.bytes)
  const clearableBytes = input.parts.reduce((sum, part) => sum + Math.max(0, part.bytes), 0)
  const signature = cacheSignature(clearableBytes, warnAtMb)
  const pressured = clearableBytes >= warnAtMb * 1024 * 1024
  return {
    collectedAt: input.collectedAt,
    warnAtMb,
    clearableBytes,
    pressured,
    dismissed: input.dismissedSignature === signature,
    parts,
    recommendation: input.recommendation?.trim() || localCacheRecommendation(parts),
    signature,
    releasedBytes: input.releasedBytes ?? null
  }
}
