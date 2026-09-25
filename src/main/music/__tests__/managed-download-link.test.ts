import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { storeManagedDownload } from '../managed-download-link'

describe('managed music storage', () => {
  it('shares downloaded bytes while keeping both file paths independently removable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bikorch-link-'))
    try {
      const downloads = join(root, 'downloads')
      await mkdir(downloads)
      const source = join(downloads, 'song.mp3')
      const library = join(root, 'library.mp3')
      await writeFile(source, 'audio-data')
      await storeManagedDownload(source, library, downloads)
      expect((await stat(source)).ino).toBe((await stat(library)).ino)
      await rm(source)
      expect(await readFile(library, 'utf8')).toBe('audio-data')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('copies external files rather than linking user-owned media into app storage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bikorch-link-'))
    try {
      const downloads = join(root, 'downloads')
      await mkdir(downloads)
      const source = join(root, 'external.mp3')
      const library = join(root, 'library.mp3')
      await writeFile(source, 'audio-data')
      await storeManagedDownload(source, library, downloads)
      expect((await stat(source)).ino).not.toBe((await stat(library)).ino)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
