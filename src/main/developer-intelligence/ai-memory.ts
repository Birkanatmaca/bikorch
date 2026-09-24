import { createHash } from 'crypto'
import { MEMORY_CATEGORIES, type MemoryCandidate } from '@shared/contracts/developer-intelligence'
import { redactSecrets } from './redaction'

/** Model output is untrusted. Only bounded, supported developer facts may become memories. */
export function parseAiMemorySuggestions(raw: unknown, promptCount: number): MemoryCandidate[] {
  const items = raw && typeof raw === 'object' && 'memories' in raw
    ? (raw as { memories?: unknown }).memories
    : null
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  const accepted: MemoryCandidate[] = []
  for (const item of items.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    if (typeof value['category'] !== 'string' || value['category'] === 'About me' || !MEMORY_CATEGORIES.includes(value['category'] as typeof MEMORY_CATEGORIES[number])) continue
    if (typeof value['content'] !== 'string') continue
    const content = value['content'].trim()
    if (content.length < 8 || content.length > 220 || redactSecrets(content).redactedCount > 0) continue
    const indices = Array.isArray(value['supportingPromptIndexes'])
      ? [...new Set(value['supportingPromptIndexes'].filter((index): index is number =>
        Number.isInteger(index) && index >= 0 && index < promptCount))]
      : []
    if (indices.length < 2) continue
    const normalized = content.toLocaleLowerCase().replace(/\s+/g, ' ')
    if (seen.has(normalized)) continue
    seen.add(normalized)
    accepted.push({
      key: `model:${createHash('sha256').update(normalized).digest('hex').slice(0, 32)}`,
      scope: 'global',
      category: value['category'],
      content,
      confidence: Math.min(0.85, 0.55 + indices.length * 0.05),
      evidenceCount: indices.length
    })
    if (accepted.length >= 6) break
  }
  return accepted
}
