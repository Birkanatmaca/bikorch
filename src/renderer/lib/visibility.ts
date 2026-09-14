export function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function onDocumentVisibility(callback: (hidden: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => undefined
  const handler = (): void => callback(isDocumentHidden())
  document.addEventListener('visibilitychange', handler)
  return () => document.removeEventListener('visibilitychange', handler)
}

export function visibilityScaledInterval(
  baseMs: number,
  hiddenMultiplier: number,
  hidden: boolean
): number {
  const safeBase = Math.max(250, Math.floor(baseMs) || 250)
  if (!hidden) return safeBase
  const multiplier = Math.max(1, hiddenMultiplier)
  return Math.min(safeBase * multiplier, 120_000)
}
