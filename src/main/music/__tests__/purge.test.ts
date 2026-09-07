import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { assertManagedMusicFile, permanentlyDeleteManagedMusicFile } from '../purge'

describe('permanent music file delete', () => {
  it('unlinks a file inside the music root and rejects paths outside it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bikorch-music-'))
    const insideDir = join(root, 'downloads')
    mkdirSync(insideDir, { recursive: true })
    const inside = join(insideDir, 'song.m4a')
    const outside = join(tmpdir(), `bikorch-outside-${Date.now()}.m4a`)
    writeFileSync(inside, 'audio')
    writeFileSync(outside, 'keep')
    try {
      expect(assertManagedMusicFile(inside, root)).toBeDefined()
      expect(() => assertManagedMusicFile(outside, root)).toThrow()
      await permanentlyDeleteManagedMusicFile(inside, root)
      expect(existsSync(inside)).toBe(false)
      expect(existsSync(outside)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
      if (existsSync(outside)) rmSync(outside, { force: true })
    }
  })
})
