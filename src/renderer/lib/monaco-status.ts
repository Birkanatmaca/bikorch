let loaded = false

export function markMonacoLoaded(): void {
  loaded = true
}

export function isMonacoLoaded(): boolean {
  return loaded
}
