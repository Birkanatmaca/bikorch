import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() }
}))

import { cleanupOrphanWorktrees, noteAgentSessionEnded } from '../reconcile'
import { loadRepoIsolation } from '../agent-run-store'
import { ensureAgentWorktree } from '../worktrees'

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

describe('orphan worktree cleanup', () => {
  const trash: string[] = []

  afterEach(async () => {
    await Promise.all(trash.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('does not delete a dirty unmanaged worktree', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bikorch-orphan-'))
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-orphan-base-'))
    trash.push(repo, baseDir)
    await run(repo, 'git', ['init'])
    await run(repo, 'git', ['config', 'user.email', 'test@bikorch.local'])
    await run(repo, 'git', ['config', 'user.name', 'Bikorch Test'])
    await writeFile(join(repo, 'README.md'), 'hello\n')
    await run(repo, 'git', ['add', 'README.md'])
    await run(repo, 'git', ['commit', '-m', 'init'])
    const created = await ensureAgentWorktree({
      projectRoot: repo,
      kind: 'codex',
      panelId: 'c1b2c3d4-aaaa-bbbb-cccc-ddddeeeeffff',
      baseDir
    })
    if (!created.ok || !created.worktreePath) throw new Error('worktree')
    await writeFile(join(created.worktreePath, 'dirty.ts'), 'export const dirty = true\n')
    const result = await cleanupOrphanWorktrees({ repoRoot: repo, baseDir })
    expect(result.removed).toBe(0)
    expect(await run(created.worktreePath, 'git', ['status', '--porcelain'])).toContain('dirty.ts')
  })

  it('treats CLI process exit as interrupted, not merged', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bikorch-orphan-'))
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-orphan-base-'))
    trash.push(repo, baseDir)
    await run(repo, 'git', ['init'])
    await run(repo, 'git', ['config', 'user.email', 'test@bikorch.local'])
    await run(repo, 'git', ['config', 'user.name', 'Bikorch Test'])
    await writeFile(join(repo, 'README.md'), 'hello\n')
    await run(repo, 'git', ['add', 'README.md'])
    await run(repo, 'git', ['commit', '-m', 'init'])
    const created = await ensureAgentWorktree({
      projectRoot: repo,
      kind: 'gemini',
      panelId: 'd1b2c3d4-aaaa-bbbb-cccc-ddddeeeeffff',
      title: 'Gemini CLI',
      baseDir
    })
    if (!created.ok || !created.worktreePath) throw new Error('worktree')
    await writeFile(join(created.worktreePath, 'note.ts'), 'export const n = 1\n')
    await noteAgentSessionEnded({
      projectRoot: repo,
      runId: 'd1b2c3d4-aaaa-bbbb-cccc-ddddeeeeffff',
      sessionId: 'd1b2c3d4-aaaa-bbbb-cccc-ddddeeeeffff',
      reason: 'exited',
      baseDir
    })
    const state = await loadRepoIsolation(repo, baseDir)
    expect(state.runs[0]?.status).toBe('interrupted')
    expect(state.runs[0]?.writerSessionId).toBeNull()
  })
})
