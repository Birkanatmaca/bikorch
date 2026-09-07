import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export function musicRootDir(): string {
  const root = join(app.getPath('userData'), 'music')
  for (const sub of ['library', 'artwork', 'cache', 'downloads']) {
    const dir = join(root, sub)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  return root
}

export function managedLibraryDir(): string {
  return join(musicRootDir(), 'library')
}

export function artworkDir(): string {
  return join(musicRootDir(), 'artwork')
}

export function appDownloadsDir(): string {
  const dir = join(musicRootDir(), 'downloads')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
