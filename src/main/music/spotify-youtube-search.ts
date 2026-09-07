export function buildYouTubeSearchTerm(artist: string | undefined, title: string): string {
  const raw = `${artist ?? ''} ${title}`
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[|/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  return raw
}

export function isYouTubeVideoId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(value)
}

function fromUrl(value: string): string | null {
  if (isYouTubeVideoId(value)) return value
  const match = value.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/)
  return match && isYouTubeVideoId(match[1]) ? match[1] : null
}

export function extractYouTubeVideoId(raw: unknown): string | null {
  if (typeof raw === 'string') return fromUrl(raw.trim())
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (typeof record.id === 'string') {
    const id = fromUrl(record.id)
    if (id) return id
  }
  if (Array.isArray(record.entries)) {
    for (const entry of record.entries) {
      const nested = extractYouTubeVideoId(entry)
      if (nested) return nested
    }
  }
  for (const key of ['webpage_url', 'original_url', 'url']) {
    const nested = extractYouTubeVideoId(record[key])
    if (nested) return nested
  }
  return null
}
