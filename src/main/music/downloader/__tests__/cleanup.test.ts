import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { cleanupDownloadArtifacts } from '../engine'

describe('failed-download cleanup', () => {
  it('removes temporary part files and leaves unrelated files alone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bikorch-clean-'))
    const output = join(root, 'song.mp3')
    const part = `${output}.part`
    const other = join(root, 'keep-me.mp3')
    writeFileSync(part, 'partial')
    writeFileSync(`${output}.ytdl`, '{}')
    writeFileSync(other, 'ok')

    await cleanupDownloadArtifacts(output)

    expect(existsSync(part)).toBe(false)
    expect(existsSync(`${output}.ytdl`)).toBe(false)
    expect(existsSync(other)).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })
})
