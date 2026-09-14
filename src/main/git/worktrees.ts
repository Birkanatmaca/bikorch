import { app } from 'electron'
import { mkdir, rm } from 'fs/promises'
import { dirname } from 'path'
import type { AgentWorktreeKind } from '@shared/contracts/git'
import { upsertAgentRun, loadRepoIsolation, saveRepoIsolation } from './agent-run-store'
import { commitIfDirty, currentBranch, headSha, pathExists, tryRepoRoot, runGit } from './git-exec'
import { provisionWorktree } from './worktree-setup'
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

async function unlinkWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await runGit(repoRoot, ['worktree', 'remove', '--force', worktreePath]).catch(async () => {
    await rm(worktreePath, { recursive: true, force: true })
    await runGit(repoRoot, ['worktree', 'prune']).catch(() => undefined)
  })
}

async function rememberRun(input: {
  projectRoot: string
  repoRoot: string
  kind: AgentWorktreeKind
  panelId: string
  title: string
  worktreePath: string
  branch: string
  baseDir: string
  status: 'active' | 'parked'
}): Promise<{ targetBranch: string; baseSha: string }> {
  const targetBranch = (await currentBranch(input.repoRoot)) ?? 'main'
  const baseSha = (await headSha(input.worktreePath).catch(() => headSha(input.repoRoot))) || ''
  const state = await loadRepoIsolation(input.repoRoot, input.baseDir)
  upsertAgentRun(state, {
    id: input.panelId,
    kind: input.kind,
    title: input.title,
    branch: input.branch,
    worktreePath: input.worktreePath,
    targetBranch,
    baseSha,
    isolationPolicy: 'isolated',
    status: input.status,
    attachedPanelId: input.status === 'active' ? input.panelId : null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
  state.targetBranch = targetBranch
  state.targetSha = (await headSha(input.repoRoot)) || state.targetSha
  await saveRepoIsolation(state, input.baseDir)
  return { targetBranch, baseSha }
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
      await provisionWorktree(repoRoot, worktreePath)
      const remembered = await rememberRun({
        projectRoot: input.projectRoot,
        repoRoot,
        kind: input.kind,
        panelId: input.panelId,
        title,
        worktreePath,
        branch,
        baseDir,
        status: 'active'
      })
      return { ok: true, worktreePath, branch, runId: input.panelId, ...remembered }
    }

    if (await pathExists(worktreePath)) {
      await commitIfDirty(worktreePath, title).catch(() => undefined)
      await unlinkWorktree(repoRoot, worktreePath)
    }

    await mkdir(dirname(worktreePath), { recursive: true })
    const branches = await runGit(repoRoot, ['branch', '--list', branch])
    if (branches.trim().length > 0) {
      await runGit(repoRoot, ['worktree', 'add', worktreePath, branch])
    } else {
      await runGit(repoRoot, ['worktree', 'add', '-b', branch, worktreePath])
    }
    await provisionWorktree(repoRoot, worktreePath)
    const remembered = await rememberRun({
      projectRoot: input.projectRoot,
      repoRoot,
      kind: input.kind,
      panelId: input.panelId,
      title,
      worktreePath,
      branch,
      baseDir,
      status: 'active'
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
  const mode = input.mode ?? 'remove'

  try {
    if (await pathExists(input.worktreePath)) {
      await commitIfDirty(input.worktreePath, title).catch(() => undefined)
    }

    const state = await loadRepoIsolation(repoRoot, baseDir)
    const run = state.runs.find((item) => item.worktreePath === input.worktreePath)
    if (run) {
      run.status = mode === 'park' ? 'parked' : 'abandoned'
      run.attachedPanelId = null
      run.updatedAt = Date.now()
      await saveRepoIsolation(state, baseDir)
    }

    if (mode === 'park') {
      return { ok: true }
    }

    await unlinkWorktree(repoRoot, input.worktreePath)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not close this agent copy' }
  }
}
