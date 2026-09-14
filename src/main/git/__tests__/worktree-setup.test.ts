import { mkdir, mkdtemp, readFile, rm, writeFile, lstat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { provisionWorktree } from '../worktree-setup'

describe('worktree setup', () => {
  const trash: string[] = []

  afterEach(async () => {
    await Promise.all(trash.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('copies env files and links node_modules', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bikorch-setup-src-'))
    const worktree = await mkdtemp(join(tmpdir(), 'bikorch-setup-wt-'))
    trash.push(repo, worktree)
    await writeFile(join(repo, '.env'), 'SECRET=1\n')
    await writeFile(join(repo, '.npmrc'), 'legacy-peer-deps=true\n')
    await mkdir(join(repo, 'node_modules'))
    await writeFile(join(repo, 'node_modules', 'pkg.json'), '{"ok":true}\n')

    await provisionWorktree(repo, worktree)

    expect(await readFile(join(worktree, '.env'), 'utf8')).toBe('SECRET=1\n')
    expect(await readFile(join(worktree, '.npmrc'), 'utf8')).toContain('legacy-peer-deps')
    const linked = await lstat(join(worktree, 'node_modules'))
    expect(linked.isSymbolicLink() || linked.isDirectory()).toBe(true)
    expect(await readFile(join(worktree, 'node_modules', 'pkg.json'), 'utf8')).toContain('ok')
  })
})
