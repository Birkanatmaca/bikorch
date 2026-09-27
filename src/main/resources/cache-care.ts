import type { CacheAnalysis } from '@shared/contracts/resources'
import { readMetaValue, writeMetaValue } from '../persistence/database'
import { explainCachePressure } from '../secretary/service'
import { clearBrowserCaches, measureClearableCacheParts } from './disk'
import { assessCachePressure, localCacheRecommendation, parseCacheWarnMb } from './cache-pressure'

const META_KEY = 'bikorch_cache_care'
const ANALYSIS_TTL_MS = 10 * 60_000

interface CacheCareRecord {
  warnAtMb: number
  dismissedSignature: string | null
  recommendation: { signature: string; text: string } | null
}

let flight: Promise<CacheAnalysis> | null = null
let memory: { at: number; analysis: CacheAnalysis } | null = null

function readRecord(): CacheCareRecord {
  try {
    const parsed = JSON.parse(readMetaValue(META_KEY) ?? '') as Partial<CacheCareRecord>
    return {
      warnAtMb: parseCacheWarnMb(parsed.warnAtMb),
      dismissedSignature: typeof parsed.dismissedSignature === 'string' ? parsed.dismissedSignature : null,
      recommendation: parsed.recommendation && typeof parsed.recommendation.signature === 'string' && typeof parsed.recommendation.text === 'string'
        ? { signature: parsed.recommendation.signature, text: parsed.recommendation.text }
        : null
    }
  } catch {
    return { warnAtMb: parseCacheWarnMb(undefined), dismissedSignature: null, recommendation: null }
  }
}

function writeRecord(record: CacheCareRecord): void {
  try {
    writeMetaValue(META_KEY, JSON.stringify(record))
  } catch {
    // Persistence may be unavailable. The in-memory analysis still drives this launch.
  }
}

async function measure(record: CacheCareRecord, releasedBytes: number | null, allowModel: boolean): Promise<CacheAnalysis> {
  const parts = await measureClearableCacheParts()
  const draft = assessCachePressure({
    parts,
    warnAtMb: record.warnAtMb,
    dismissedSignature: record.dismissedSignature,
    recommendation: null,
    collectedAt: Date.now(),
    releasedBytes
  })
  const cachedAdvice = record.recommendation?.signature === draft.signature ? record.recommendation.text : null
  let recommendation = cachedAdvice
  if (!recommendation && allowModel && draft.pressured && !draft.dismissed) {
    try {
      recommendation = await explainCachePressure(parts.filter((part) => part.bytes > 0))
    } catch {
      recommendation = null
    }
    if (recommendation) writeRecord({ ...record, recommendation: { signature: draft.signature, text: recommendation } })
  }
  const analysis = { ...draft, recommendation: recommendation || localCacheRecommendation(parts) }
  memory = { at: Date.now(), analysis }
  return analysis
}

export function getCacheAnalysis(force = false): Promise<CacheAnalysis> {
  if (!force && memory && Date.now() - memory.at < ANALYSIS_TTL_MS) return Promise.resolve(memory.analysis)
  if (!flight) {
    const record = readRecord()
    flight = measure(record, null, true).finally(() => {
      flight = null
    })
  }
  return flight
}

export async function setCacheWarnMb(value: unknown): Promise<CacheAnalysis> {
  const record = readRecord()
  const next = { ...record, warnAtMb: parseCacheWarnMb(value) }
  writeRecord(next)
  memory = null
  return measure(next, null, true)
}

export async function respondToCachePressure(accept: boolean): Promise<CacheAnalysis> {
  const record = readRecord()
  if (!accept) {
    const current = await measure(record, null, false)
    const next = { ...record, dismissedSignature: current.signature }
    writeRecord(next)
    memory = null
    return measure(next, null, false)
  }
  const releasedBytes = await clearBrowserCaches()
  memory = null
  const analysis = await measure(record, releasedBytes, false)
  writeRecord({ ...record, dismissedSignature: null, recommendation: null })
  return analysis
}
