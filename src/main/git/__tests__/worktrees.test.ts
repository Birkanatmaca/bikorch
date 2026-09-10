import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() }
}))

import { ensureAgentWorktree, removeAgentWorktree } from '../worktrees'

function run(cwd: string, command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr || stdout || `${command} exited ${code}`))
    })
  })
}

describe('agent worktrees', () => {
  const trash: string[] = []

  afterEach(async () => {
    await Promise.all(trash.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('adds a named-branch worktree and removes it', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bikorch-repo-'))
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-wt-'))
    trash.push(repo, baseDir)
    await run(repo, 'git', ['init'])
    await run(repo, 'git', ['config', 'user.email', 'test@bikorch.local'])
    await run(repo, 'git', ['config', 'user.name', 'Bikorch Test'])
    await writeFile(join(repo, 'README.md'), 'hello\n')
    await run(repo, 'git', ['add', 'README.md'])
    await run(repo, 'git', ['commit', '-m', 'init'])

    const created = await ensureAgentWorktree({
      projectRoot: repo,
      kind: 'claude',
      panelId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      baseDir
    })
    expect(created.ok).toBe(true)
    if (!created.ok || !created.worktreePath) throw new Error('expected worktree')
    expect(created.worktreePath.startsWith(baseDir)).toBe(true)

    const listed = await run(repo, 'git', ['worktree', 'list', '--porcelain'])
    const listedNorm = listed.replace(/\\/g, '/').toLowerCase()
    const createdNorm = created.worktreePath.replace(/\\/g, '/').toLowerCase()
    expect(listedNorm.includes('claude-a1b2c3d4')).toBe(true)
    expect(listedNorm.includes(createdNorm)).toBe(true)
    expect(created.branch).toBe('bikorch/claude-a1b2c3d4')
    expect(listed).toMatch(/bikorch\/claude-a1b2c3d4/)

    const removed = await removeAgentWorktree({
      projectRoot: repo,
      worktreePath: created.worktreePath,
      baseDir
    })
    expect(removed.ok).toBe(true)
  })
})
