const BLOCKED_HOSTS = new Set([
  'spotify.com',
  'open.spotify.com',
  'accounts.spotify.com',
  'netflix.com',
  'www.netflix.com',
  'disneyplus.com',
  'www.disneyplus.com',
  'hulu.com',
  'www.hulu.com',
  'primevideo.com',
  'www.primevideo.com',
  'tv.apple.com',
  'max.com',
  'www.max.com',
  'play.hbomax.com',
  'peacocktv.com',
  'www.peacocktv.com',
  'music.apple.com',
  'itunes.apple.com',
  'metadata.google.internal'
])

const BLOCKED_HOST_SUFFIXES = ['.spotify.com', '.netflix.com', '.disneyplus.com']

export interface UrlValidationOk {
  ok: true
  url: string
  hostname: string
}

export interface UrlValidationErr {
  ok: false
  error: string
}

export type UrlValidationResult = UrlValidationOk | UrlValidationErr

function isIpv4(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return NaN
    return Number(part)
  })
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return nums
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true
  if (host === '::' || host === '0.0.0.0') return true

  const ipv4 = isIpv4(host)
  if (ipv4) return isPrivateIpv4(ipv4)
  return false
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  if (BLOCKED_HOSTS.has(hostname.toLowerCase()) || BLOCKED_HOSTS.has(host)) return true
  return BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.toLowerCase().endsWith(suffix))
}

export function validateDownloadUrl(raw: string): UrlValidationResult {
  if (typeof raw !== 'string') return { ok: false, error: 'URL is required' }
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: 'URL is required' }
  if (trimmed.length > 2048) return { ok: false, error: 'URL is too long' }
  if (/\s/.test(trimmed)) return { ok: false, error: 'URL must not contain whitespace' }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return { ok: false, error: 'Only HTTP and HTTPS URLs are allowed' }
  }

  let parsed: URL
  try {
    parsed = /^https?:\/\//i.test(trimmed) ? new URL(trimmed) : new URL(`https://${trimmed}`)
  } catch {
    return { ok: false, error: 'Enter a valid HTTP or HTTPS URL' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only HTTP and HTTPS URLs are allowed' }
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URLs with embedded credentials are not allowed' }
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname) return { ok: false, error: 'URL is missing a hostname' }

  if (isPrivateOrLocalHost(hostname)) {
    return { ok: false, error: 'Local and internal network destinations are not allowed' }
  }

  if (isBlockedHost(hostname)) {
    return {
      ok: false,
      error: 'This source is protected or does not permit download in Bikorch'
    }
  }

  parsed.hash = ''
  return { ok: true, url: parsed.toString(), hostname }
}

export function isPrivateResolvedAddress(address: string): boolean {
  return isPrivateOrLocalHost(address)
}

export function mapEngineError(raw: string, exitCode: number | null): string {
  const text = raw.toLowerCase()
  if (text.includes('drm') || text.includes('protected content') || text.includes('widevine')) {
    return 'This source is protected and cannot be downloaded.'
  }
  if (
    text.includes('sign in') ||
    text.includes('login required') ||
    text.includes('age-restricted') ||
    text.includes('confirm you’re not a bot') ||
    text.includes('confirm you\'re not a bot')
  ) {
    return 'This source requires authentication that Bikorch does not support.'
  }
  if (text.includes('private video') || text.includes('this video is private')) {
    return 'This media is private or unavailable.'
  }
  if (text.includes('video unavailable') || text.includes('has been removed')) {
    return 'This media is unavailable.'
  }
  if (text.includes('http error 403') || text.includes('access denied')) {
    return 'Access was denied by the source.'
  }
  if (
    text.includes('unsupported url') ||
    text.includes('no video formats') ||
    text.includes('requested format is not available')
  ) {
    return 'This source is not supported or does not permit the requested download.'
  }
  if (exitCode === 2) {
    return 'The media engine rejected this request. The source may be unsupported or restricted.'
  }
  return 'Download failed. The source may be unsupported, restricted, or unavailable.'
}
