import { shell } from 'electron'

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'i.ytimg.com'
])

export function isAllowedMusicExternalUrl(url: string): boolean {
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

export function openExternalUrl(url: string): { ok: true } | { ok: false; error: string } {
  if (!isAllowedMusicExternalUrl(url)) {
    return { ok: false, error: 'That link is not allowed to open from Music.' }
  }
  void shell.openExternal(url)
  return { ok: true }
}
