import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() }
}))

import { ensureAgentWorktree } from '../worktrees'
import { abortFold, clearFoldSessions, inspectIsolation, prepareFold } from '../isolation'
import { buildConflictResolvePrompt } from '@shared/lib/isolation-prompt'

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

async function initRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'bikorch-iso-'))
  await run(repo, 'git', ['init'])
  await run(repo, 'git', ['config', 'user.email', 'test@bikorch.local'])
  await run(repo, 'git', ['config', 'user.name', 'Bikorch Test'])
  await writeFile(join(repo, 'shared.ts'), 'export const n = 1\n')
  await writeFile(join(repo, 'README.md'), 'hello\n')
  await run(repo, 'git', ['add', '.'])
  await run(repo, 'git', ['commit', '-m', 'init'])
  return repo
}

describe('agent isolation merge', () => {
  const trash: string[] = []

  afterEach(async () => {
    clearFoldSessions()
    await Promise.all(trash.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('reports overlap when two lanes edit the same file', async () => {
    const repo = await initRepo()
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-iso-base-'))
    trash.push(repo, baseDir)
    const claudeId = 'a1b2c3d4-aaaa-bbbb-cccc-ddddeeeeffff'
    const cursorId = 'b2c3d4e5-aaaa-bbbb-cccc-ddddeeeeffff'
    const claude = await ensureAgentWorktree({ projectRoot: repo, kind: 'claude', panelId: claudeId, baseDir })
    const cursor = await ensureAgentWorktree({ projectRoot: repo, kind: 'cursor', panelId: cursorId, baseDir })
    if (!claude.ok || !claude.worktreePath || !cursor.ok || !cursor.worktreePath) throw new Error('worktrees')
    await writeFile(join(claude.worktreePath, 'shared.ts'), 'export const n = 2\n')
    await writeFile(join(cursor.worktreePath, 'shared.ts'), 'export const n = 3\n')

    const snapshot = await inspectIsolation({
      projectRoot: repo,
      lanes: [
        { panelId: claudeId, kind: 'claude', title: 'Auth', worktreePath: claude.worktreePath },
        { panelId: cursorId, kind: 'cursor', title: 'UI', worktreePath: cursor.worktreePath }
      ]
    })
    expect(snapshot.overlaps).toEqual([
      expect.objectContaining({ path: 'shared.ts', labels: ['Auth', 'UI'] })
    ])
  })

  it('folds a clean lane into an integration worktree', async () => {
    const repo = await initRepo()
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-iso-base-'))
    trash.push(repo, baseDir)
    const claudeId = 'c1b2c3d4-aaaa-bbbb-cccc-ddddeeeeffff'
    const cursorId = 'd2c3d4e5-aaaa-bbbb-cccc-ddddeeeeffff'
    const claude = await ensureAgentWorktree({ projectRoot: repo, kind: 'claude', panelId: claudeId, baseDir })
    const cursor = await ensureAgentWorktree({ projectRoot: repo, kind: 'cursor', panelId: cursorId, baseDir })
    if (!claude.ok || !claude.worktreePath || !cursor.ok || !cursor.worktreePath) throw new Error('worktrees')
    await writeFile(join(claude.worktreePath, 'auth.ts'), 'export const auth = true\n')
    await writeFile(join(cursor.worktreePath, 'ui.ts'), 'export const ui = true\n')

    const snapshot = await inspectIsolation({
      projectRoot: repo,
      lanes: [
        { panelId: claudeId, kind: 'claude', title: 'Auth', worktreePath: claude.worktreePath },
        { panelId: cursorId, kind: 'cursor', title: 'UI', worktreePath: cursor.worktreePath }
      ]
    })
    expect(snapshot.overlaps).toEqual([])

    const fold = await prepareFold({
      projectRoot: repo,
      panelId: claudeId,
      kind: 'claude',
      title: 'Auth',
      worktreePath: claude.worktreePath,
      baseDir
    })
    expect(fold.status).toBe('clean')
    expect(fold.files).toContain('auth.ts')
    await abortFold({ projectRoot: repo, baseDir })
  })

  it('opens a conflict fold when both lanes edit the same lines', async () => {
    const repo = await initRepo()
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-iso-base-'))
    trash.push(repo, baseDir)
    const claudeId = 'e1b2c3d4-aaaa-bbbb-cccc-ddddeeeeffff'
    const cursorId = 'f2c3d4e5-aaaa-bbbb-cccc-ddddeeeeffff'
    const claude = await ensureAgentWorktree({ projectRoot: repo, kind: 'claude', panelId: claudeId, baseDir })
    const cursor = await ensureAgentWorktree({ projectRoot: repo, kind: 'cursor', panelId: cursorId, baseDir })
    if (!claude.ok || !claude.worktreePath || !cursor.ok || !cursor.worktreePath) throw new Error('worktrees')
    await writeFile(join(claude.worktreePath, 'shared.ts'), 'export const n = 2\n')
    await writeFile(join(cursor.worktreePath, 'shared.ts'), 'export const n = 3\n')

    const first = await prepareFold({
      projectRoot: repo,
      panelId: claudeId,
      kind: 'claude',
      title: 'Auth',
      worktreePath: claude.worktreePath,
      baseDir
    })
    expect(first.status).toBe('clean')
    const { acceptFold } = await import('../isolation')
    const accepted = await acceptFold({ projectRoot: repo, baseDir })
    expect(accepted.ok).toBe(true)

    const second = await prepareFold({
      projectRoot: repo,
      panelId: cursorId,
      kind: 'cursor',
      title: 'UI',
      worktreePath: cursor.worktreePath,
      baseDir
    })
    expect(second.status).toBe('conflict')
    expect(second.conflicts.some((file) => file.path === 'shared.ts')).toBe(true)
    const prompt = buildConflictResolvePrompt({
      task: 'UI',
      resolverLabel: 'Cursor CLI',
      otherLabels: ['Auth'],
      files: second.conflicts
    })
    expect(prompt).toContain('Task: UI')
    expect(prompt).toContain('shared.ts')
    expect(prompt).toContain('Do not modify unrelated files')
    await abortFold({ projectRoot: repo, baseDir })
  })
})
