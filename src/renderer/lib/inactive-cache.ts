export function keysToKeep(
  activeId: string | null,
  recents: string[],
  inactiveLimit: number
): Set<string> {
  const keep = new Set<string>()
  if (activeId) keep.add(activeId)
  const extra = Math.max(0, Math.floor(inactiveLimit))
  for (const id of recents) {
    if (!id || keep.has(id)) continue
    if (keep.size - (activeId ? 1 : 0) >= extra) break
    keep.add(id)
  }
  return keep
}

export function evictRecordKeys<T>(
  record: Record<string, T>,
  keep: Set<string>
): Record<string, T> {
  const next: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) {
    if (keep.has(key)) next[key] = value
  }
  return next
}

export function rememberRecent(recents: string[], id: string, max = 24): string[] {
  return [id, ...recents.filter((item) => item !== id)].slice(0, max)
}
