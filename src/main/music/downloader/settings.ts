import { existsSync, mkdirSync } from 'fs'
import type { DownloadSettings } from '@shared/contracts/downloads'
import { createDefaultDownloadSettings } from '@shared/contracts/downloads'
import { readMetaValue, writeMetaValue } from '../../persistence/database'
import { appDownloadsDir } from '../paths'

const SETTINGS_KEY = 'music_download_settings_json'

function parseSettings(raw: string | null): DownloadSettings {
  const defaults = createDefaultDownloadSettings()
  if (!raw) return defaults
  try {
    const parsed = JSON.parse(raw) as Partial<DownloadSettings>
    const maxConcurrent =
      parsed.maxConcurrentDownloads === 2 ? 2 : parsed.maxConcurrentDownloads === 1 ? 1 : defaults.maxConcurrentDownloads
    return {
      defaultFolder: null,
      defaultAudioFormat: 'mp3',
      defaultAudioQuality: parsed.defaultAudioQuality === 'standard' ? 'standard' : 'high',
      defaultVideoQuality:
        parsed.defaultVideoQuality === 'best' ||
        parsed.defaultVideoQuality === '1080' ||
        parsed.defaultVideoQuality === '720' ||
        parsed.defaultVideoQuality === '480'
          ? parsed.defaultVideoQuality
          : defaults.defaultVideoQuality,
      importAudioToLibrary: true,
      maxConcurrentDownloads: maxConcurrent,
      keepHistory: typeof parsed.keepHistory === 'boolean' ? parsed.keepHistory : defaults.keepHistory
    }
  } catch {
    return defaults
  }
}

export function readDownloadSettings(): DownloadSettings {
  return parseSettings(readMetaValue(SETTINGS_KEY))
}

export function writeDownloadSettings(settings: DownloadSettings): DownloadSettings {
  writeMetaValue(
    SETTINGS_KEY,
    JSON.stringify({ ...settings, defaultFolder: null, defaultAudioFormat: 'mp3', importAudioToLibrary: true })
  )
  return readDownloadSettings()
}

export function resolveDownloadFolder(): string {
  const dir = appDownloadsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
