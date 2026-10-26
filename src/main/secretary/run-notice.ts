import type { SecretaryRunNotice } from '@shared/contracts/secretary'
import { sanitizeSecretaryModelText } from './input-sanitizer'

/** The model's completion notice, or one built from the report and Git facts. */
export function buildRunNotice(
  raw: unknown,
  fallback: { reply: string; failed: boolean; changedFiles: string[] }
): SecretaryRunNotice {
  const clean = (value: unknown, limit: number): string =>
    typeof value === 'string' ? sanitizeSecretaryModelText(value.replace(/\s+/g, ' ').trim(), limit) : ''
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const headline = clean(body?.headline, 140)
  const highlights = Array.isArray(body?.highlights)
    ? body.highlights.map((item) => clean(item, 160)).filter(Boolean).slice(0, 4)
    : []
  if (headline) return { headline, highlights }
  const firstSentence = fallback.reply.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? ''
  const files = fallback.changedFiles
  return {
    headline: clean(firstSentence, 140) || (fallback.failed ? 'The work did not finish.' : 'The work is done.'),
    highlights: files.length > 0
      ? [`${files.length} file${files.length === 1 ? '' : 's'} changed: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ', …' : ''}`]
      : []
  }
}
