import { app } from 'electron'
import { readdir } from 'fs/promises'
import { join } from 'path'
import type { AgentRunRecord } from '@shared/contracts/git'
import { loadRepoIsolation, saveRepoIsolation, upsertAgentRun } from './agent-run-store'
import { isFoldingAgentRunStatus, isTerminalAgentRunStatus, normalizeAgentRunStatus } from './agent-lifecycle'
import { commitIfDirty, currentBranch, headSha, isWorkingTreeDirty, pathExists, runGit, tryRepoRoot } from './git-exec'
import { hashRepoRoot, isManagedWorktreePath } from './worktree-paths'

function worktreeBaseDir(override?: string): string {
  return override ?? app.getPath('userData')
}

function worktreeLines(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean)
}

async function uniqueCommits(worktreePath: string, targetRef: string): Promise<boolean> {
  const log = (
    await runGit(worktreePath, ['log', '--oneline', `${targetRef}..HEAD`]).catch(() => '')
  ).trim()
  return log.length > 0
}

async function safeRemoveWorktree(repoRoot: string, worktreePath: string): Promise<boolean> {
  if (await isWorkingTreeDirty(worktreePath)) return false
  try {
    await runGit(repoRoot, ['worktree', 'remove', worktreePath])
    return true
  } catch {
    return false
  }
}

export async function reconcilePersistedProjects(): Promise<void> {
  const { app } = await import('electron')
  const { listPersistedProjectFolders } = await import('../persistence/database')
  const baseDir = app.getPath('userData')
  for (const folder of listPersistedProjectFolders()) {
    await reconcileAgentRuns({ projectRoot: folder, baseDir }).catch(() => undefined)
  }
}

export async function cleanupOrphanWorktrees(input: {
  repoRoot: string
  baseDir: string
}): Promise<{ kept: number; removed: number }> {
  const state = await loadRepoIsolation(input.repoRoot, input.baseDir)
  const known = new Set(state.runs.map((run) => run.worktreePath.toLowerCase()))
  if (state.fold?.integrationPath) known.add(state.fold.integrationPath.toLowerCase())
  const listed = worktreeLines(await runGit(input.repoRoot, ['worktree', 'list', '--porcelain']).catch(() => ''))
  let removed = 0
  let kept = 0
  const target = state.targetSha || (await headSha(input.repoRoot))

  for (const worktreePath of listed) {
    if (!isManagedWorktreePath(input.baseDir, worktreePath)) continue
    if (known.has(worktreePath.toLowerCase())) {
      kept += 1
      continue
    }
    if (!(await pathExists(worktreePath))) continue
    const dirty = await isWorkingTreeDirty(worktreePath)
    const hasWork = dirty || (target ? await uniqueCommits(worktreePath, target) : true)
    if (hasWork) {
      kept += 1
      continue
    }
    if (await safeRemoveWorktree(input.repoRoot, worktreePath)) removed += 1
    else kept += 1
  }

  const slotRoot = join(input.baseDir, 'agent-worktrees', hashRepoRoot(input.repoRoot))
  if (await pathExists(slotRoot)) {
    const entries = await readdir(slotRoot).catch(() => [])
    for (const entry of entries) {
      const worktreePath = join(slotRoot, entry)
      if (known.has(worktreePath.toLowerCase())) continue
      if (!(await pathExists(worktreePath))) continue
      if (await isWorkingTreeDirty(worktreePath)) {
        kept += 1
        continue
      }
      if (await safeRemoveWorktree(input.repoRoot, worktreePath)) removed += 1
    }
  }

  return { kept, removed }
}

export async function reconcileAgentRuns(input: {
  projectRoot: string
  baseDir: string
  livePanelIds?: string[]
}): Promise<{ runs: AgentRunRecord[]; interrupted: number }> {
  const repoRoot = (await tryRepoRoot(input.projectRoot)) ?? input.projectRoot
  const state = await loadRepoIsolation(repoRoot, input.baseDir)
  const live = new Set(input.livePanelIds ?? [])
  let interrupted = 0
  const targetBranch = (await currentBranch(repoRoot)) ?? state.targetBranch ?? 'HEAD'
  const targetSha = (await headSha(repoRoot)) || state.targetSha

  for (const run of state.runs) {
    run.status = normalizeAgentRunStatus(run.status)
    if (isTerminalAgentRunStatus(run.status)) continue
    const liveHere = live.has(run.id) || (run.writerSessionId ? live.has(run.writerSessionId) : false)
    if (!liveHere && run.writerSessionId) {
      run.writerSessionId = null
    }
    if (!liveHere && run.status === 'running') {
      run.status = 'interrupted'
      run.attachedPanelId = null
      interrupted += 1
    }
    if (!(await pathExists(run.worktreePath)) && !isFoldingAgentRunStatus(run.status)) {
      run.status = run.status === 'parked' ? 'parked' : 'interrupted'
    }
  }

  state.targetBranch = targetBranch
  state.targetSha = targetSha
  await saveRepoIsolation(state, input.baseDir)
  await cleanupOrphanWorktrees({ repoRoot, baseDir: input.baseDir })
  return { runs: state.runs, interrupted }
}

export async function checkpointAgentRun(input: {
  projectRoot: string
  runId: string
  title?: string
  baseDir?: string
}): Promise<{ ok: true; sha: string | null } | { ok: false; error: string }> {
  const baseDir = worktreeBaseDir(input.baseDir)
  const repoRoot = (await tryRepoRoot(input.projectRoot)) ?? input.projectRoot
  const state = await loadRepoIsolation(repoRoot, baseDir)
  const run = state.runs.find((item) => item.id === input.runId)
  if (!run) return { ok: false, error: 'Unknown agent run' }
  if (!(await pathExists(run.worktreePath))) return { ok: false, error: 'Worktree missing' }
  await commitIfDirty(run.worktreePath, input.title || run.title)
  const sha = await headSha(run.worktreePath)
  run.lastCheckpointSha = sha || run.lastCheckpointSha
  run.lastCheckpointAt = Date.now()
  upsertAgentRun(state, run)
  await saveRepoIsolation(state, baseDir)
  return { ok: true, sha: sha || null }
}

export async function discardAgentRun(input: {
  projectRoot: string
  runId: string
  baseDir?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const baseDir = worktreeBaseDir(input.baseDir)
  const repoRoot = (await tryRepoRoot(input.projectRoot)) ?? input.projectRoot
  const state = await loadRepoIsolation(repoRoot, baseDir)
  const run = state.runs.find((item) => item.id === input.runId)
  if (!run) return { ok: false, error: 'Unknown agent run' }
  if (await pathExists(run.worktreePath)) {
    await commitIfDirty(run.worktreePath, run.title).catch(() => undefined)
    if (await isWorkingTreeDirty(run.worktreePath)) {
      return { ok: false, error: 'Worktree is still dirty; checkpoint failed. Refusing to delete work.' }
    }
    const removed = await runGit(repoRoot, ['worktree', 'remove', run.worktreePath]).then(
      () => true,
      () => false
    )
    if (!removed) {
      return { ok: false, error: 'Could not remove a clean worktree without --force' }
    }
  }
  run.status = 'abandoned'
  run.attachedPanelId = null
  run.writerSessionId = null
  run.updatedAt = Date.now()
  if (state.fold?.runId === run.id || state.fold?.panelId === run.id) state.fold = null
  await saveRepoIsolation(state, baseDir)
  return { ok: true }
}

export async function noteAgentSessionEnded(input: {
  projectRoot: string
  runId: string
  sessionId: string
  reason: 'exited' | 'parked' | 'interrupted'
  baseDir?: string
}): Promise<{ ok: true }> {
  const baseDir = worktreeBaseDir(input.baseDir)
  const repoRoot = (await tryRepoRoot(input.projectRoot)) ?? input.projectRoot
  const state = await loadRepoIsolation(repoRoot, baseDir)
  const run = state.runs.find((item) => item.id === input.runId)
  if (!run) return { ok: true }
  if (isTerminalAgentRunStatus(run.status) || isFoldingAgentRunStatus(run.status)) {
    if (run.writerSessionId === input.sessionId) run.writerSessionId = null
    await saveRepoIsolation(state, baseDir)
    return { ok: true }
  }
  if (await pathExists(run.worktreePath)) {
    await commitIfDirty(run.worktreePath, run.title).catch(() => undefined)
    run.lastCheckpointSha = (await headSha(run.worktreePath)) || run.lastCheckpointSha
    run.lastCheckpointAt = Date.now()
  }
  run.writerSessionId = null
  run.attachedPanelId = null
  run.status = input.reason === 'parked' ? 'parked' : 'interrupted'
  run.updatedAt = Date.now()
  await saveRepoIsolation(state, baseDir)
  return { ok: true }
}
