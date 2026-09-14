import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() }
}))

import { ensureAgentWorktree, removeAgentWorktree } from '../worktrees'
import { abortFold, clearFoldSessions, inspectIsolation, prepareFold, updateWorktreeProvision } from '../isolation'
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

describe('agent isolation merge', { timeout: 20_000 }, () => {
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
      baseDir,
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
      baseDir,
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
    expect(second.conflicts[0]?.hunks).toContain('<<<<<<<')
    expect(second.integrationPath).toBeTruthy()
    expect(second.conflicts[0]?.absolutePath.startsWith(second.integrationPath!)).toBe(true)
    const prompt = buildConflictResolvePrompt({
      task: 'UI',
      resolverLabel: 'Cursor CLI',
      otherLabels: ['Auth'],
      files: second.conflicts,
      integrationPath: second.integrationPath
    })
    expect(prompt).toContain('Task: UI')
    expect(prompt).toContain('shared.ts')
    expect(prompt).toContain(`Working directory: ${second.integrationPath}`)
    expect(prompt).toContain('Do not modify unrelated files')
    await abortFold({ projectRoot: repo, baseDir })
  })

  it('accepts a conflict after the working tree is resolved without a manual git add', { timeout: 20_000 }, async () => {
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
    expect((await acceptFold({ projectRoot: repo, baseDir })).ok).toBe(true)
    const subjects = await run(repo, 'git', ['log', '--format=%s'])
    expect(subjects).toContain('Auth')
    expect(subjects).not.toMatch(/^bikorch:/m)

    const second = await prepareFold({
      projectRoot: repo,
      panelId: cursorId,
      kind: 'cursor',
      title: 'UI',
      worktreePath: cursor.worktreePath,
      baseDir
    })
    expect(second.status).toBe('conflict')
    expect(second.integrationPath).toBeTruthy()
    await writeFile(join(second.integrationPath!, 'shared.ts'), 'export const n = 2\nexport const n = 3\n')
    const accepted = await acceptFold({ projectRoot: repo, baseDir })
    expect(accepted).toEqual({ ok: true })
  })

  it('squashes onto the target without copying bikorch commits', async () => {
    const repo = await initRepo()
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-iso-base-'))
    trash.push(repo, baseDir)
    const claudeId = 'c1b2c3d4-aaaa-bbbb-cccc-ddddeeeeffff'
    const claude = await ensureAgentWorktree({ projectRoot: repo, kind: 'claude', panelId: claudeId, baseDir })
    if (!claude.ok || !claude.worktreePath) throw new Error('worktrees')
    await writeFile(join(claude.worktreePath, 'auth.ts'), 'export const auth = true\n')
    const fold = await prepareFold({
      projectRoot: repo,
      panelId: claudeId,
      kind: 'claude',
      title: 'Auth',
      worktreePath: claude.worktreePath,
      baseDir
    })
    expect(fold.targetBranch).toBeTruthy()
    expect(fold.targetSha).toBeTruthy()
    expect(fold.stale).toBe(false)
    const { acceptFold } = await import('../isolation')
    expect((await acceptFold({ projectRoot: repo, baseDir })).ok).toBe(true)
    const subjects = (await run(repo, 'git', ['log', '--format=%s'])).trim().split('\n')
    expect(subjects[0]).toBe('Auth')
    expect(subjects.some((line) => line.startsWith('bikorch:'))).toBe(false)
  })

  it('blocks accept when the target moved and recovers the fold after restart', async () => {
    const repo = await initRepo()
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-iso-base-'))
    trash.push(repo, baseDir)
    const claudeId = 'd1b2c3d4-aaaa-bbbb-cccc-ddddeeeeffff'
    const claude = await ensureAgentWorktree({ projectRoot: repo, kind: 'claude', panelId: claudeId, baseDir })
    if (!claude.ok || !claude.worktreePath) throw new Error('worktrees')
    await writeFile(join(claude.worktreePath, 'auth.ts'), 'export const auth = true\n')
    await prepareFold({
      projectRoot: repo,
      panelId: claudeId,
      kind: 'claude',
      title: 'Auth',
      worktreePath: claude.worktreePath,
      baseDir
    })
    await writeFile(join(repo, 'README.md'), 'hello\nchanged\n')
    await run(repo, 'git', ['add', 'README.md'])
    await run(repo, 'git', ['commit', '-m', 'target moved'])

    clearFoldSessions()
    const recovered = await inspectIsolation({
      projectRoot: repo,
      baseDir,
      lanes: [{ panelId: claudeId, kind: 'claude', title: 'Auth', worktreePath: claude.worktreePath }]
    })
    expect(recovered.fold?.stale).toBe(true)
    expect(recovered.queue.some((item) => item.status === 'stale')).toBe(true)
    const { acceptFold } = await import('../isolation')
    const blocked = await acceptFold({ projectRoot: repo, baseDir })
    expect(blocked.ok).toBe(false)
    if (blocked.ok) throw new Error('expected stale accept to fail')
    expect(blocked.error).toMatch(/moved/i)
  })

  it('folds while the main worktree is dirty', async () => {
    const repo = await initRepo()
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-iso-base-'))
    trash.push(repo, baseDir)
    const claudeId = 'e1b2c3d4-aaaa-bbbb-cccc-ddddeeeeffff'
    const claude = await ensureAgentWorktree({ projectRoot: repo, kind: 'claude', panelId: claudeId, baseDir })
    if (!claude.ok || !claude.worktreePath) throw new Error('worktrees')
    await writeFile(join(claude.worktreePath, 'auth.ts'), 'export const auth = true\n')
    await writeFile(join(repo, 'README.md'), 'dirty main\n')
    const fold = await prepareFold({
      projectRoot: repo,
      panelId: claudeId,
      kind: 'claude',
      title: 'Auth',
      worktreePath: claude.worktreePath,
      baseDir
    })
    expect(fold.status).toBe('clean')
    const { acceptFold } = await import('../isolation')
    const blocked = await acceptFold({ projectRoot: repo, baseDir })
    expect(blocked.ok).toBe(false)
    await abortFold({ projectRoot: repo, baseDir })
  })

  it('refuses default cleanup of a dirty worktree and recovers recoveries after restart', async () => {
    const repo = await initRepo()
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-iso-base-'))
    trash.push(repo, baseDir)
    const claudeId = 'f1b2c3d4-aaaa-bbbb-cccc-ddddeeeeffff'
    const claude = await ensureAgentWorktree({
      projectRoot: repo,
      kind: 'claude',
      panelId: claudeId,
      title: 'Auth',
      baseDir
    })
    if (!claude.ok || !claude.worktreePath) throw new Error('worktrees')
    await writeFile(join(claude.worktreePath, 'auth.ts'), 'export const auth = true\n')
    const parked = await removeAgentWorktree({
      projectRoot: repo,
      worktreePath: claude.worktreePath,
      title: 'Auth',
      baseDir
    })
    expect(parked.ok).toBe(true)
    expect(await run(claude.worktreePath, 'git', ['status', '--porcelain'])).toBe('')
    clearFoldSessions()
    const recovered = await inspectIsolation({
      projectRoot: repo,
      baseDir,
      lanes: []
    })
    expect(recovered.lanes.some((lane) => lane.runId === claudeId)).toBe(true)
    expect(recovered.recoveries.some((item) => item.runId === claudeId && item.actions.includes('resume'))).toBe(true)
  })

  it('records the current target branch instead of hardcoding main', async () => {
    const repo = await initRepo()
    await run(repo, 'git', ['branch', '-M', 'develop'])
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-iso-base-'))
    trash.push(repo, baseDir)
    const claudeId = 'aabbccdd-aaaa-bbbb-cccc-ddddeeeeffff'
    const claude = await ensureAgentWorktree({
      projectRoot: repo,
      kind: 'claude',
      panelId: claudeId,
      title: 'Auth',
      baseDir
    })
    if (!claude.ok || !claude.worktreePath) throw new Error('worktrees')
    expect(claude.targetBranch).toBe('develop')
    await writeFile(join(claude.worktreePath, 'auth.ts'), 'export const auth = true\n')
    const fold = await prepareFold({
      projectRoot: repo,
      panelId: claudeId,
      kind: 'claude',
      title: 'Auth',
      worktreePath: claude.worktreePath,
      baseDir
    })
    expect(fold.targetBranch).toBe('develop')
    await abortFold({ projectRoot: repo, baseDir })
  })

  it('blocks a second writer on the same agent worktree', async () => {
    const repo = await initRepo()
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-iso-base-'))
    trash.push(repo, baseDir)
    const claudeId = 'bbccddee-aaaa-bbbb-cccc-ddddeeeeffff'
    const first = await ensureAgentWorktree({
      projectRoot: repo,
      kind: 'claude',
      panelId: claudeId,
      title: 'Auth',
      baseDir
    })
    if (!first.ok || !first.worktreePath) throw new Error('worktrees')
    const { loadRepoIsolation, saveRepoIsolation } = await import('../agent-run-store')
    const state = await loadRepoIsolation(repo, baseDir)
    const run = state.runs.find((item) => item.id === claudeId)
    if (!run) throw new Error('missing run')
    run.writerSessionId = 'other-session'
    run.status = 'running'
    await saveRepoIsolation(state, baseDir)
    const second = await ensureAgentWorktree({
      projectRoot: repo,
      kind: 'claude',
      panelId: claudeId,
      title: 'Auth',
      baseDir
    })
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('expected writer lock')
    expect(second.error).toMatch(/active CLI/i)
  })

  it('defaults worktree provision to no secret copy and isolated installs', async () => {
    const repo = await initRepo()
    const baseDir = await mkdtemp(join(tmpdir(), 'bikorch-iso-base-'))
    trash.push(repo, baseDir)
    await writeFile(join(repo, '.env'), 'SECRET=1\n')
    const snapshot = await inspectIsolation({ projectRoot: repo, baseDir, lanes: [] })
    expect(snapshot.provision).toEqual({ copyLocalFiles: [], dependencyMode: 'isolated' })
    expect(snapshot.availableLocalFiles).toContain('.env')
    const saved = await updateWorktreeProvision({
      projectRoot: repo,
      baseDir,
      copyLocalFiles: ['.env'],
      dependencyMode: 'share'
    })
    expect(saved.provision).toEqual({ copyLocalFiles: ['.env'], dependencyMode: 'share' })
  })
})
