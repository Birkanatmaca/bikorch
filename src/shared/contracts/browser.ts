export type BrowserViewportId = 'fluid' | 'phone' | 'tablet' | 'laptop' | 'desktop' | 'custom'

export interface BrowserViewport {
  id: BrowserViewportId
  label: string
  width: number | null
}

export const BROWSER_VIEWPORTS: readonly BrowserViewport[] = [
  { id: 'fluid', label: 'Fluid', width: null },
  { id: 'phone', label: 'Phone', width: 390 },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'laptop', label: 'Laptop', width: 1280 },
  { id: 'desktop', label: 'Desktop', width: 1440 },
  { id: 'custom', label: 'Custom', width: null }
] as const

export const LOCAL_BROWSER_PRESETS = [
  { label: '3000', url: 'http://localhost:3000/' },
  { label: '5173', url: 'http://localhost:5173/' },
  { label: '8080', url: 'http://localhost:8080/' },
  { label: '4321', url: 'http://localhost:4321/' }
] as const

export const DEFAULT_CUSTOM_VIEWPORT_WIDTH = 390
export const SEARCH_ENDPOINT = 'https://duckduckgo.com/?q='

const BLOCKED_PROTOCOL = /^(javascript|data|file|blob|vbscript|about):/i

export function looksLikeUrl(input: string): boolean {
  const value = input.trim()
  if (!value) return false
  if (/^https?:\/\//i.test(value)) return true
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i.test(value)) return true
  if (/^\[[0-9a-f:]+\](:\d+)?([/?#]|$)/i.test(value)) return true
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(value)) return true
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([/:?#]|$)/i.test(value)
}

export function resolveBrowserNavigation(
  input: string
): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Enter a URL or search' }
  if (BLOCKED_PROTOCOL.test(trimmed)) return { ok: false, error: 'This address is not allowed' }

  let candidate = trimmed
  if (looksLikeUrl(trimmed)) {
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
      const host = candidate.split(/[/?#]/)[0] ?? candidate
      const local = /^(localhost|127\.0\.0\.1|\[::1\])/i.test(host)
      candidate = `${local ? 'http' : 'https'}://${candidate}`
    }
  } else {
    candidate = `${SEARCH_ENDPOINT}${encodeURIComponent(trimmed)}`
  }

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'Only http and https are allowed' }
    }
    return { ok: true, url: url.href }
  } catch {
    return { ok: false, error: 'Invalid address' }
  }
}

export function displayBrowserHost(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.host || parsed.hostname || url
  } catch {
    return url
  }
}

export function viewportWidth(
  id: BrowserViewportId,
  customWidth: number
): number | null {
  if (id === 'fluid') return null
  if (id === 'custom') {
    if (!Number.isFinite(customWidth)) return DEFAULT_CUSTOM_VIEWPORT_WIDTH
    return Math.min(2560, Math.max(240, Math.round(customWidth)))
  }
  return BROWSER_VIEWPORTS.find((item) => item.id === id)?.width ?? null
}

export function fitViewportScale(availablePx: number, targetPx: number | null): number {
  if (!targetPx || availablePx <= 0 || targetPx <= availablePx) return 1
  return Math.max(0.2, availablePx / targetPx)
}
