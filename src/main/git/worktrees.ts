import { app } from 'electron'
import { mkdir, rm } from 'fs/promises'
import { dirname } from 'path'
import type { AgentWorktreeKind } from '@shared/contracts/git'
import { upsertAgentRun, loadRepoIsolation, saveRepoIsolation } from './agent-run-store'
import { commitIfDirty, currentBranch, headSha, isWorkingTreeDirty, pathExists, tryRepoRoot, runGit } from './git-exec'
import { provisionWorktree, type WorktreeProvisionResult } from './worktree-setup'
import { buildResumeContext } from './agent-lifecycle'
import { agentBranchName, buildAgentWorktreePath, isManagedWorktreePath } from './worktree-paths'

function worktreeBaseDir(override?: string): string {
  return override ?? app.getPath('userData')
}

function listWorktreePaths(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean)
}

async function applyWorktreeProvision(
  repoRoot: string,
  worktreePath: string,
  baseDir: string
): Promise<WorktreeProvisionResult> {
  const state = await loadRepoIsolation(repoRoot, baseDir)
  const result = await provisionWorktree(repoRoot, worktreePath, state.provision)
  if (!result.ok) {
    state.setupError = result.failure
    await saveRepoIsolation(state, baseDir)
  }
  return result
}

async function unlinkWorktree(repoRoot: string, worktreePath: string, force: boolean): Promise<void> {
  if (!force && (await isWorkingTreeDirty(worktreePath))) {
    throw new Error('Refusing to delete a dirty worktree')
  }
  const args = force ? ['worktree', 'remove', '--force', worktreePath] : ['worktree', 'remove', worktreePath]
  await runGit(repoRoot, args).catch(async () => {
    if (!force) throw new Error('Could not remove worktree without --force')
    await rm(worktreePath, { recursive: true, force: true })
    await runGit(repoRoot, ['worktree', 'prune']).catch(() => undefined)
  })
}

/**
 * Persists the AgentRun for this panel. Today `run.id` is still the panel id
 * so parked work can reopen with the same UI identity. Longer term these
 * should split: AgentRun ID (domain) ≠ Session ID (process) ≠ Panel ID (UI).
 */
async function rememberRun(input: {
  projectRoot: string
  repoRoot: string
  kind: AgentWorktreeKind
  panelId: string
  title: string
  worktreePath: string
  branch: string
  baseDir: string
  status: 'running' | 'parked'
}): Promise<{ targetBranch: string; baseSha: string; resumeContext: string }> {
  const targetBranch = (await currentBranch(input.repoRoot)) ?? 'HEAD'
  const baseSha = (await headSha(input.worktreePath).catch(() => headSha(input.repoRoot))) || ''
  const state = await loadRepoIsolation(input.repoRoot, input.baseDir)
  const occupant = state.runs.find(
    (run) =>
      run.worktreePath.toLowerCase() === input.worktreePath.toLowerCase() &&
      run.writerSessionId &&
      run.writerSessionId !== input.panelId &&
      run.status === 'running'
  )
  if (occupant) {
    throw new Error('This agent copy already has an active CLI')
  }
  const existing = state.runs.find((run) => run.id === input.panelId)
  const nextStatus = existing && (existing.status === 'awaiting-review' || existing.status === 'conflict')
    ? existing.status
    : input.status
  upsertAgentRun(state, {
    id: input.panelId,
    kind: input.kind,
    title: input.title,
    branch: input.branch,
    worktreePath: input.worktreePath,
    targetBranch,
    baseSha: existing?.baseSha || baseSha,
    isolationPolicy: 'isolated',
    status: nextStatus === 'parked' ? 'parked' : nextStatus === 'awaiting-review' || nextStatus === 'conflict' ? nextStatus : 'running',
    attachedPanelId: input.status === 'running' ? input.panelId : null,
    writerSessionId: input.status === 'running' ? input.panelId : null,
    lastCheckpointSha: existing?.lastCheckpointSha ?? null,
    lastCheckpointAt: existing?.lastCheckpointAt ?? null,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now()
  })
  state.targetBranch = targetBranch
  state.targetSha = (await headSha(input.repoRoot)) || state.targetSha
  await saveRepoIsolation(state, input.baseDir)
  const resumeContext = buildResumeContext({
    run: {
      title: input.title,
      kind: input.kind,
      branch: input.branch,
      targetBranch,
      baseSha: existing?.baseSha || baseSha,
      status: nextStatus === 'parked' ? 'parked' : 'running'
    },
    files: [],
    headSha: baseSha,
    lastCheckpointSha: existing?.lastCheckpointSha
  })
  return { targetBranch, baseSha: existing?.baseSha || baseSha, resumeContext }
}

export async function ensureAgentWorktree(input: {
  projectRoot: string
  kind: AgentWorktreeKind
  panelId: string
  title?: string
  baseDir?: string
}): Promise<
  | {
      ok: true
      worktreePath: string | null
      branch?: string
      runId?: string
      targetBranch?: string
      baseSha?: string
      resumeContext?: string
    }
  | { ok: false; error: string }
> {
  const repoRoot = await tryRepoRoot(input.projectRoot)
  if (!repoRoot) return { ok: true, worktreePath: null }

  const baseDir = worktreeBaseDir(input.baseDir)
  const worktreePath = buildAgentWorktreePath(baseDir, repoRoot, input.kind, input.panelId)
  const branch = agentBranchName(input.kind, input.panelId)
  const title = input.title?.trim() || `${input.kind} agent`

  try {
    const listed = listWorktreePaths(await runGit(repoRoot, ['worktree', 'list', '--porcelain']))
    const alreadyLinked = listed.some((path) => path.toLowerCase() === worktreePath.toLowerCase())
    if (alreadyLinked && (await pathExists(worktreePath))) {
      await applyWorktreeProvision(repoRoot, worktreePath, baseDir)
      const remembered = await rememberRun({
        projectRoot: input.projectRoot,
        repoRoot,
        kind: input.kind,
        panelId: input.panelId,
        title,
        worktreePath,
        branch,
        baseDir,
        status: 'running'
      })
      return { ok: true, worktreePath, branch, runId: input.panelId, ...remembered }
    }

    if (await pathExists(worktreePath)) {
      await commitIfDirty(worktreePath, title).catch(() => undefined)
      if (!(await isWorkingTreeDirty(worktreePath))) {
        await unlinkWorktree(repoRoot, worktreePath, true)
      } else {
        await applyWorktreeProvision(repoRoot, worktreePath, baseDir)
        const remembered = await rememberRun({
          projectRoot: input.projectRoot,
          repoRoot,
          kind: input.kind,
          panelId: input.panelId,
          title,
          worktreePath,
          branch,
          baseDir,
          status: 'running'
        })
        return { ok: true, worktreePath, branch, runId: input.panelId, ...remembered }
      }
    }

    await mkdir(dirname(worktreePath), { recursive: true })
    const branches = await runGit(repoRoot, ['branch', '--list', branch])
    if (branches.trim().length > 0) {
      await runGit(repoRoot, ['worktree', 'add', worktreePath, branch])
    } else {
      await runGit(repoRoot, ['worktree', 'add', '-b', branch, worktreePath])
    }
    await applyWorktreeProvision(repoRoot, worktreePath, baseDir)
    const remembered = await rememberRun({
      projectRoot: input.projectRoot,
      repoRoot,
      kind: input.kind,
      panelId: input.panelId,
      title,
      worktreePath,
      branch,
      baseDir,
      status: 'running'
    })
    return { ok: true, worktreePath, branch, runId: input.panelId, ...remembered }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not isolate this agent' }
  }
}

export async function removeAgentWorktree(input: {
  projectRoot: string
  worktreePath: string
  title?: string
  mode?: 'park' | 'remove'
  baseDir?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const baseDir = worktreeBaseDir(input.baseDir)
  if (!isManagedWorktreePath(baseDir, input.worktreePath)) {
    return { ok: false, error: 'Worktree path is not managed by Bikorch' }
  }

  const repoRoot = (await tryRepoRoot(input.projectRoot)) ?? input.projectRoot
  const title = input.title?.trim() || 'agent work'
  const mode = input.mode ?? 'park'

  try {
    if (await pathExists(input.worktreePath)) {
      await commitIfDirty(input.worktreePath, title).catch(() => undefined)
    }

    const state = await loadRepoIsolation(repoRoot, baseDir)
    const run = state.runs.find((item) => item.worktreePath === input.worktreePath)
    if (run) {
      run.status = mode === 'park' ? 'parked' : 'abandoned'
      run.attachedPanelId = null
      run.writerSessionId = null
      run.updatedAt = Date.now()
      await saveRepoIsolation(state, baseDir)
    }

    if (mode === 'park') {
      return { ok: true }
    }

    if (await isWorkingTreeDirty(input.worktreePath)) {
      return { ok: false, error: 'Worktree is still dirty after checkpoint. Refusing to delete work.' }
    }
    await unlinkWorktree(repoRoot, input.worktreePath, false)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not close this agent copy' }
  }
}
