import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { assertPathInside, sanitizeFilename, tempSidecars, uniqueFilename } from '../filenames'

describe('sanitizeFilename', () => {
  it('strips reserved and traversal characters', () => {
    expect(sanitizeFilename('../etc/passwd')).toBe('.._etc_passwd')
    expect(sanitizeFilename('Track: Live?')).toBe('Track_ Live_')
    expect(sanitizeFilename('con')).toBe('download-con')
    expect(sanitizeFilename('   ')).toBe('download')
  })
})

describe('path validation', () => {
  it('keeps files inside the download root and rejects escapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'bikorch-dl-'))
    try {
      const inside = join(root, 'song.mp3')
      writeFileSync(inside, 'x')
      expect(assertPathInside(root, inside)).toBeDefined()
      expect(() => assertPathInside(root, join(root, '..', 'outside.mp3'))).toThrow()
      expect(() => assertPathInside(root, join(root, 'nested', '..', '..', 'outside.mp3'))).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('handles collisions and temp sidecars', () => {
    const root = mkdtempSync(join(tmpdir(), 'bikorch-dl-'))
    try {
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'track.mp3'), 'a')
      expect(uniqueFilename(root, 'track', 'mp3')).toBe('track (1).mp3')
      expect(tempSidecars(join(root, 'track.mp3'))).toContain(join(root, 'track.mp3.part'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
