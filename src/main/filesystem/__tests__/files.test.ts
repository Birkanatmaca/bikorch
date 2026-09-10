import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertPathWithinRoot } from '../path-guard'
import { readProjectFile, writeProjectFile } from '../index'

describe('assertPathWithinRoot', () => {
  it('allows files inside the project root', () => {
    const root = '/Users/dev/project'
    expect(assertPathWithinRoot(root, join(root, 'src/app.ts'))).toBe(join(root, 'src/app.ts'))
  })

  it('rejects paths that escape the project root', () => {
    expect(() => assertPathWithinRoot('/Users/dev/project', '/Users/dev/project/../secret')).toThrow(
      /outside project root/
    )
  })
})

describe('writeProjectFile', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('writes utf-8 content inside the project and refuses paths outside it', async () => {
    root = await mkdtemp(join(tmpdir(), 'bikorch-fs-'))
    const file = join(root, 'note.ts')
    await writeFile(file, ' cons t x = 1\n', 'utf-8')

    const written = await writeProjectFile(root, file, 'const x = 2\n')
    expect(written).toBe(file)
    expect(await readFile(file, 'utf-8')).toBe('const x = 2\n')
    expect(await readProjectFile(root, file)).toBe('const x = 2\n')

    await expect(writeProjectFile(root, join(root, '..', 'escape.ts'), 'nope')).rejects.toThrow(
      /outside project root/
    )
  })

  it('refuses to write over a directory', async () => {
    root = await mkdtemp(join(tmpdir(), 'bikorch-fs-'))
    const dir = join(root, 'src')
    await mkdir(dir)
    await expect(writeProjectFile(root, dir, 'nope')).rejects.toThrow(/not a file/)
  })
})
