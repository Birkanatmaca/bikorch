import { mkdir, mkdtemp, readFile, rm, writeFile, lstat, access } from 'fs/promises'
import { constants } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { provisionWorktree, setWorktreeSetupRunner } from '../worktree-setup'

async function missing(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return false
  } catch {
    return true
  }
}

describe('worktree setup', () => {
  const trash: string[] = []

  afterEach(async () => {
    setWorktreeSetupRunner(null)
    await Promise.all(trash.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('does not copy secrets or share node_modules by default', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bikorch-setup-src-'))
    const worktree = await mkdtemp(join(tmpdir(), 'bikorch-setup-wt-'))
    trash.push(repo, worktree)
    await writeFile(join(repo, '.env'), 'SECRET=1\n')
    await writeFile(join(repo, '.npmrc'), '//registry.npmjs.org/:_authToken=secret\n')
    await mkdir(join(repo, 'node_modules'))
    await writeFile(join(repo, 'node_modules', 'pkg.json'), '{"ok":true}\n')

    await provisionWorktree(repo, worktree)

    expect(await missing(join(worktree, '.env'))).toBe(true)
    expect(await missing(join(worktree, '.npmrc'))).toBe(true)
    expect(await missing(join(worktree, 'node_modules'))).toBe(true)
  })

  it('does not run install in isolated mode', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bikorch-setup-src-'))
    const worktree = await mkdtemp(join(tmpdir(), 'bikorch-setup-wt-'))
    trash.push(repo, worktree)
    await writeFile(join(worktree, 'package.json'), '{"name":"demo"}\n')
    await writeFile(join(worktree, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    let ran = 0
    setWorktreeSetupRunner(async () => {
      ran += 1
      return { ok: true, output: '' }
    })

    await provisionWorktree(repo, worktree, {
      copyLocalFiles: [],
      dependencyMode: 'isolated'
    })

    expect(ran).toBe(0)
  })

  it('copies only allowlisted local files', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bikorch-setup-src-'))
    const worktree = await mkdtemp(join(tmpdir(), 'bikorch-setup-wt-'))
    trash.push(repo, worktree)
    await writeFile(join(repo, '.env'), 'SECRET=1\n')
    await writeFile(join(repo, '.env.development'), 'DEV=1\n')
    await writeFile(join(repo, '.npmrc'), 'legacy-peer-deps=true\n')

    await provisionWorktree(repo, worktree, {
      copyLocalFiles: ['.env.development'],
      dependencyMode: 'isolated'
    })

    expect(await missing(join(worktree, '.env'))).toBe(true)
    expect(await missing(join(worktree, '.npmrc'))).toBe(true)
    expect(await readFile(join(worktree, '.env.development'), 'utf8')).toBe('DEV=1\n')
  })

  it('shares node_modules only when that mode is selected', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bikorch-setup-src-'))
    const worktree = await mkdtemp(join(tmpdir(), 'bikorch-setup-wt-'))
    trash.push(repo, worktree)
    await mkdir(join(repo, 'node_modules'))
    await writeFile(join(repo, 'node_modules', 'pkg.json'), '{"ok":true}\n')

    await provisionWorktree(repo, worktree, {
      copyLocalFiles: [],
      dependencyMode: 'share'
    })

    const linked = await lstat(join(worktree, 'node_modules'))
    expect(linked.isSymbolicLink() || linked.isDirectory()).toBe(true)
    expect(await readFile(join(worktree, 'node_modules', 'pkg.json'), 'utf8')).toContain('ok')
  })

  it('runs the detected install command in setup mode', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bikorch-setup-src-'))
    const worktree = await mkdtemp(join(tmpdir(), 'bikorch-setup-wt-'))
    trash.push(repo, worktree)
    await writeFile(join(worktree, 'package.json'), '{"name":"demo"}\n')
    await writeFile(join(worktree, 'package-lock.json'), '{}\n')
    const ran: Array<{ cwd: string; command: string; args: string[] }> = []
    setWorktreeSetupRunner(async (cwd, command, args) => {
      ran.push({ cwd, command, args })
      return { ok: true, output: '' }
    })

    await provisionWorktree(repo, worktree, {
      copyLocalFiles: [],
      dependencyMode: 'setup'
    })

    expect(ran).toEqual([{ cwd: worktree, command: 'npm', args: ['install'] }])
  })

  it('returns a setup failure when the install command fails', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bikorch-setup-src-'))
    const worktree = await mkdtemp(join(tmpdir(), 'bikorch-setup-wt-'))
    trash.push(repo, worktree)
    await writeFile(join(worktree, 'package.json'), '{"name":"demo"}\n')
    await writeFile(join(worktree, 'package-lock.json'), '{}\n')
    setWorktreeSetupRunner(async () => ({ ok: false, output: 'ERR\n', exitCode: 1 }))

    const result = await provisionWorktree(repo, worktree, {
      copyLocalFiles: [],
      dependencyMode: 'setup'
    })

    expect(result).toEqual({
      ok: false,
      failure: { command: 'npm', args: ['install'], output: 'ERR\n', exitCode: 1 }
    })
  })
})
