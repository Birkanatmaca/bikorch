import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import { homedir } from 'os'
import type { BinaryPresence, DownloadEngineStatus } from '@shared/contracts/downloads'

function exe(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

export function managedBinDir(): string {
  try {
    return join(app.getPath('userData'), 'bin')
  } catch {
    return join(homedir(), 'AppData', 'Roaming', 'ai-dev-workspace', 'bin')
  }
}

function resourceBinDirs(root: string): string[] {
  return [
    join(root, process.platform, process.arch),
    join(root, process.platform),
    root
  ]
}

function candidateDirs(): string[] {
  const dirs: string[] = []
  try {
    dirs.push(...resourceBinDirs(join(process.resourcesPath, 'bin')))
  } catch {
    // resourcesPath may be unavailable in unit tests
  }
  try {
    dirs.push(...resourceBinDirs(join(app.getAppPath(), 'resources', 'bin')))
  } catch {
    // app may be unavailable in unit tests
  }
  dirs.push(...resourceBinDirs(join(process.cwd(), 'resources', 'bin')))

  dirs.push(managedBinDir())
  try {
    dirs.push(join(app.getPath('userData'), 'music', 'bin'))
  } catch {
    // ignore
  }

  const roaming = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  dirs.push(join(roaming, 'Bikorch', 'bin'))
  dirs.push(join(roaming, 'ai-dev-workspace', 'bin'))

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    dirs.push(join(local, 'Microsoft', 'WinGet', 'Links'))
    dirs.push(join(local, 'Programs', 'yt-dlp'))
    dirs.push(join(local, 'Programs', 'ffmpeg', 'bin'))
    dirs.push(join(homedir(), 'scoop', 'shims'))
    dirs.push(join(homedir(), 'scoop', 'apps', 'yt-dlp', 'current'))
    dirs.push(join(homedir(), 'scoop', 'apps', 'ffmpeg', 'current', 'bin'))
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin'))
  }

  return [...new Set(dirs)]
}

function lookOnPath(name: string): string | null {
  const pathValue = process.env.PATH ?? ''
  const delimiter = process.platform === 'win32' ? ';' : ':'
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function findBinary(names: string[]): string | null {
  const dirs = candidateDirs()
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
    const onPath = lookOnPath(name)
    if (onPath) return onPath
  }
  return null
}

function inspectBinary(names: string[]): BinaryPresence {
  const path = findBinary(names)
  return path ? { available: true, path } : { available: false }
}

export function downloadSetupHint(): string {
  return [
    'Bikorch can download, but it needs the official yt-dlp engine first.',
    `Use Install official tools to fetch yt-dlp (and FFmpeg) into ${managedBinDir()}.`,
    'Sources: https://github.com/yt-dlp/yt-dlp  ·  https://ffmpeg.org/download.html'
  ].join(' ')
}

export async function detectDownloadEngine(): Promise<DownloadEngineStatus> {
  return {
    ytDlp: inspectBinary([exe('yt-dlp')]),
    ffmpeg: inspectBinary([exe('ffmpeg')]),
    setupHint: downloadSetupHint()
  }
}

export function ffmpegDirectory(ffmpegPath?: string): string | undefined {
  if (!ffmpegPath) return undefined
  return dirname(ffmpegPath)
}
