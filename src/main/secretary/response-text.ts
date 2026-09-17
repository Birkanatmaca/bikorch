export function extractResponseText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const body = result as Record<string, unknown>
  if (typeof body.output_text === 'string' && body.output_text.trim()) {
    return body.output_text.trim()
  }
  const output = Array.isArray(body.output) ? body.output : []
  const chunks: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string' && text.trim()) chunks.push(text.trim())
    }
  }
  return chunks.join('\n').trim()
}

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    // continue
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim()) as unknown
    } catch {
      // continue
    }
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown
    } catch {
      return null
    }
  }
  return null
}

export function readSecretaryReply(text: string): { reply: string; planRaw: unknown; openKindsRaw: unknown } {
  const parsed = parseJsonObject(text)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const body = parsed as Record<string, unknown>
    const reply = typeof body.reply === 'string' ? body.reply.trim() : ''
    return {
      reply: reply || (typeof body.overview === 'string' ? body.overview.trim() : '') || text.trim(),
      planRaw: body.plan ?? (Array.isArray(body.assignments) ? parsed : null),
      openKindsRaw: body.openKinds ?? body.openPanels ?? null
    }
  }
  return { reply: text.trim(), planRaw: null, openKindsRaw: null }
}
