import { app } from 'electron'
import { mkdir, readFile, rm } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import type {
  AgentRunRecord,
  GitDiffResponse,
  IsolationConflictFile,
  IsolationFoldSession,
  IsolationInspectRequest,
  IsolationInspectResponse,
  IsolationLane,
  IsolationOverlap,
  MergeQueueItem
} from '@shared/contracts/git'
import { detectLanguage } from '@shared/lib/languages'
import {
  buildConflictResolvePrompt,
  extractConflictHunks,
  hasConflictMarkers
} from '@shared/lib/isolation-prompt'
import {
  clearRepoIsolationMemory,
  loadRepoIsolation,
  saveRepoIsolation,
  upsertAgentRun
} from './agent-run-store'
import {
  commitIfDirty,
  currentBranch,
  foldCommitMessage,
  headSha,
  isWorkingTreeDirty,
  pathExists,
  resolveRepoRoot,
  runGit
} from './git-exec'
import {
  agentBranchName,
  buildIntegrationWorktreePath,
  integrationBranchName,
  isManagedWorktreePath
} from './worktree-paths'

const MAX_SNIPPET = 1_500
const MAX_WORKING_BYTES = 2 * 1024 * 1024
const foldByRepo = new Map<string, IsolationFoldSession>()

function worktreeBaseDir(override?: string): string {
  return override ?? app.getPath('userData')
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort()
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function clip(text: string): string {
  if (text.length <= MAX_SNIPPET) return text
  return `${text.slice(0, MAX_SNIPPET)}\n…`
}

function safeRelativePath(filePath: string): string {
  const clean = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!clean || clean === '.' || clean.includes('\0') || clean.split('/').includes('..')) {
    throw new Error('Invalid file path')
  }
  return clean
}

async function listChangedFiles(worktreePath: string, mainHead: string): Promise<string[]> {
  const mergeBase = (await runGit(worktreePath, ['merge-base', 'HEAD', mainHead]).catch(() => mainHead)).trim() || mainHead
  const committed = await runGit(worktreePath, ['diff', '--name-only', mergeBase]).catch(() => '')
  const unstaged = await runGit(worktreePath, ['diff', '--name-only']).catch(() => '')
  const staged = await runGit(worktreePath, ['diff', '--name-only', '--cached']).catch(() => '')
  const untracked = await runGit(worktreePath, ['ls-files', '--others', '--exclude-standard']).catch(() => '')
  return uniqueSorted(lines([committed, unstaged, staged, untracked].join('\n')))
}

async function listUnmerged(cwd: string): Promise<string[]> {
  const raw = await runGit(cwd, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')
  return uniqueSorted(lines(raw))
}

async function readWorkingText(absolutePath: string): Promise<string> {
  try {
    const buffer = await readFile(absolutePath)
    if (buffer.includes(0) || buffer.byteLength > MAX_WORKING_BYTES) return ''
    return buffer.toString('utf8')
  } catch {
    return ''
  }
}

async function showStage(cwd: string, stage: 1 | 2 | 3, file: string): Promise<string | undefined> {
  const text = await runGit(cwd, ['show', `:${stage}:${file}`]).catch(() => '')
  return text.length > 0 ? clip(text) : undefined
}

async function stageResolvedConflicts(cwd: string): Promise<void> {
  const unmerged = await listUnmerged(cwd)
  for (const file of unmerged) {
    const text = await readWorkingText(join(cwd, file))
    if (hasConflictMarkers(text)) continue
    await runGit(cwd, ['add', '--', file]).catch(() => undefined)
  }
}

async function mergeHeadPresent(cwd: string): Promise<boolean> {
  const sha = (await runGit(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).catch(() => '')).trim()
  return sha.length > 0
}

async function resolveTarget(repoRoot: string): Promise<{ branch: string; sha: string }> {
  const branch = (await currentBranch(repoRoot)) ?? 'main'
  const sha = await headSha(repoRoot)
  return { branch, sha }
}

function markStale(session: IsolationFoldSession, targetSha: string): IsolationFoldSession {
  session.stale = Boolean(session.targetSha) && session.targetSha !== targetSha
  return session
}

async function refreshFoldSession(
  session: IsolationFoldSession,
  targetSha: string
): Promise<IsolationFoldSession> {
  markStale(session, targetSha)
  if (!session.integrationPath) return session
  await stageResolvedConflicts(session.integrationPath)
  const unmerged = await listUnmerged(session.integrationPath)
  if (unmerged.length === 0) {
    if (session.status === 'conflict') {
      session.status = 'clean'
      session.conflicts = []
    }
    return session
  }
  session.status = 'conflict'
  session.files = unmerged
  session.conflicts = []
  for (const file of unmerged) {
    session.conflicts.push({
      path: file,
      absolutePath: join(session.integrationPath, file),
      base: await showStage(session.integrationPath, 1, file),
      main: await showStage(session.integrationPath, 2, file),
      agent: await showStage(session.integrationPath, 3, file)
    })
  }
  return session
}

function overlapsFromLanes(lanes: IsolationLane[]): IsolationOverlap[] {
  const owners = new Map<string, string[]>()
  for (const lane of lanes) {
    for (const file of lane.files) {
      const list = owners.get(file) ?? []
      if (!list.includes(lane.panelId)) list.push(lane.panelId)
      owners.set(file, list)
    }
  }
  return [...owners.entries()]
    .filter(([, panelIds]) => panelIds.length > 1)
    .map(([path, panelIds]) => ({
      path,
      panelIds,
      labels: panelIds.map((id) => lanes.find((lane) => lane.panelId === id)?.title ?? id)
    }))
}

function queueFrom(lanes: IsolationLane[], fold: IsolationFoldSession | null): MergeQueueItem[] {
  const items: MergeQueueItem[] = []
  for (const lane of lanes) {
    const isActive = fold && fold.status !== 'empty' && fold.panelId === lane.panelId
    if (!isActive && lane.files.length === 0) continue
    let status: MergeQueueItem['status'] = 'pending'
    if (isActive) {
      if (fold.stale) status = 'stale'
      else if (fold.status === 'conflict') status = 'conflict'
      else status = 'review'
    }
    items.push({
      runId: lane.runId,
      panelId: lane.panelId,
      kind: lane.kind,
      title: lane.title,
      status,
      fileCount: isActive ? fold.files.length : lane.files.length
    })
  }
  return items
}

async function persistState(
  repoRoot: string,
  baseDir: string,
  fold: IsolationFoldSession | null,
  extras?: { targetBranch?: string; targetSha?: string }
): Promise<void> {
  const state = await loadRepoIsolation(repoRoot, baseDir)
  state.fold = fold
  if (extras?.targetBranch) state.targetBranch = extras.targetBranch
  if (extras?.targetSha) state.targetSha = extras.targetSha
  await saveRepoIsolation(state, baseDir)
}

async function describeLane(input: {
  panelId: string
  kind: IsolationLane['kind']
  title: string
  worktreePath: string
  attached: boolean
  run?: AgentRunRecord
  targetBranch: string
  targetSha: string
}): Promise<IsolationLane | null> {
  if (!(await pathExists(input.worktreePath))) {
    if (!input.run) return null
    return {
      panelId: input.panelId,
      runId: input.run.id,
      kind: input.kind,
      title: input.title,
      worktreePath: input.worktreePath,
      branch: input.run.branch,
      files: [],
      targetBranch: input.run.targetBranch,
      baseSha: input.run.baseSha,
      isolationPolicy: input.run.isolationPolicy,
      isolationState: 'missing',
      attached: input.attached
    }
  }
  const files = input.targetSha ? await listChangedFiles(input.worktreePath, input.targetSha) : []
  const branch = (await currentBranch(input.worktreePath)) ?? agentBranchName(input.kind, input.panelId)
  return {
    panelId: input.panelId,
    runId: input.run?.id ?? input.panelId,
    kind: input.kind,
    title: input.title,
    worktreePath: input.worktreePath,
    branch,
    files,
    targetBranch: input.run?.targetBranch ?? input.targetBranch,
    baseSha: input.run?.baseSha ?? input.targetSha,
    isolationPolicy: input.run?.isolationPolicy ?? 'isolated',
    isolationState: input.attached ? 'ready' : 'parked',
    attached: input.attached
  }
}

export { buildConflictResolvePrompt }

export async function inspectIsolation(
  request: IsolationInspectRequest
): Promise<IsolationInspectResponse> {
  const repoRoot = await resolveRepoRoot(request.projectRoot)
  const baseDir = worktreeBaseDir(request.baseDir)
  const target = await resolveTarget(repoRoot)
  const state = await loadRepoIsolation(repoRoot, baseDir)
  const attachedIds = new Set(request.lanes.map((lane) => lane.panelId))
  const lanes: IsolationLane[] = []

  for (const input of request.lanes) {
    const run = state.runs.find((item) => item.id === input.panelId)
    const lane = await describeLane({
      ...input,
      attached: true,
      run,
      targetBranch: target.branch,
      targetSha: target.sha
    })
    if (lane) {
      lanes.push(lane)
      upsertAgentRun(state, {
        id: lane.runId,
        kind: lane.kind,
        title: lane.title,
        branch: lane.branch,
        worktreePath: lane.worktreePath,
        targetBranch: lane.targetBranch,
        baseSha: lane.baseSha,
        isolationPolicy: 'isolated',
        status: 'active',
        attachedPanelId: lane.panelId,
        createdAt: run?.createdAt ?? Date.now(),
        updatedAt: Date.now()
      })
    }
  }

  for (const run of state.runs) {
    if (attachedIds.has(run.id)) continue
    if (run.status === 'abandoned' || run.status === 'accepted') continue
    if (run.isolationPolicy === 'shared') continue
    run.status = 'parked'
    run.attachedPanelId = null
    const lane = await describeLane({
      panelId: run.id,
      kind: run.kind,
      title: run.title,
      worktreePath: run.worktreePath,
      attached: false,
      run,
      targetBranch: target.branch,
      targetSha: target.sha
    })
    if (lane && (lane.files.length > 0 || lane.isolationState !== 'missing')) {
      lanes.push(lane)
    }
  }

  let fold = foldByRepo.get(repoRoot) ?? state.fold
  if (fold && !foldByRepo.has(repoRoot) && fold.integrationPath && (await pathExists(fold.integrationPath))) {
    foldByRepo.set(repoRoot, fold)
  } else if (fold && fold.integrationPath && !(await pathExists(fold.integrationPath))) {
    fold = null
    foldByRepo.delete(repoRoot)
  }
  if (fold) {
    await refreshFoldSession(fold, target.sha)
    foldByRepo.set(repoRoot, fold)
  }

  state.targetBranch = target.branch
  state.targetSha = target.sha
  state.fold = fold
  await saveRepoIsolation(state, baseDir)

  return {
    lanes,
    overlaps: overlapsFromLanes(lanes),
    fold,
    queue: queueFrom(lanes, fold),
    targetBranch: target.branch,
    targetSha: target.sha
  }
}

export async function prepareFold(input: {
  projectRoot: string
  panelId: string
  kind: IsolationLane['kind']
  title: string
  worktreePath: string
  baseDir?: string
}): Promise<IsolationFoldSession> {
  const repoRoot = await resolveRepoRoot(input.projectRoot)
  const baseDir = worktreeBaseDir(input.baseDir)
  if (!isManagedWorktreePath(baseDir, input.worktreePath)) {
    throw new Error('Worktree path is not managed by Bikorch')
  }

  const target = await resolveTarget(repoRoot)
  await commitIfDirty(input.worktreePath, input.title)
  const branch = (await currentBranch(input.worktreePath)) ?? agentBranchName(input.kind, input.panelId)
  const changed = uniqueSorted(lines(await runGit(repoRoot, ['diff', '--name-only', 'HEAD', branch]).catch(() => '')))
  const empty = (sessionStatus: IsolationFoldSession['status'] = 'empty'): IsolationFoldSession => ({
    id: input.panelId,
    runId: input.panelId,
    panelId: input.panelId,
    kind: input.kind,
    title: input.title,
    branch,
    agentWorktreePath: input.worktreePath,
    targetBranch: target.branch,
    baseSha: target.sha,
    targetSha: target.sha,
    stale: false,
    status: sessionStatus,
    files: [],
    conflicts: []
  })

  if (changed.length === 0) {
    const session = empty()
    await persistState(repoRoot, baseDir, null, target)
    return session
  }

  const existing = foldByRepo.get(repoRoot)
  if (existing) await abortFold({ projectRoot: repoRoot, baseDir })

  const integrationPath = buildIntegrationWorktreePath(baseDir, repoRoot, input.panelId)
  const integrationBranch = integrationBranchName(input.panelId)
  if (await pathExists(integrationPath)) {
    await runGit(repoRoot, ['worktree', 'remove', '--force', integrationPath]).catch(async () => {
      await rm(integrationPath, { recursive: true, force: true })
      await runGit(repoRoot, ['worktree', 'prune']).catch(() => undefined)
    })
  }
  await runGit(repoRoot, ['branch', '-D', integrationBranch]).catch(() => undefined)
  await mkdir(dirname(integrationPath), { recursive: true })
  await runGit(repoRoot, ['worktree', 'add', '-b', integrationBranch, integrationPath, target.branch])

  let status: IsolationFoldSession['status'] = 'clean'
  try {
    await runGit(integrationPath, ['merge', '--no-edit', branch])
  } catch {
    status = 'conflict'
  }

  const conflicts: IsolationConflictFile[] = []
  if (status === 'conflict') {
    const unmerged = await listUnmerged(integrationPath)
    for (const file of unmerged) {
      const absolutePath = join(integrationPath, file)
      const hunks = extractConflictHunks(await readWorkingText(absolutePath))
      const conflict: IsolationConflictFile = {
        path: file,
        absolutePath
      }
      if (hunks) {
        conflict.hunks = hunks
      } else {
        conflict.base = await showStage(integrationPath, 1, file)
        conflict.main = await showStage(integrationPath, 2, file)
        conflict.agent = await showStage(integrationPath, 3, file)
      }
      conflicts.push(conflict)
    }
  }

  const files =
    status === 'conflict'
      ? conflicts.map((file) => file.path)
      : uniqueSorted(lines(await runGit(integrationPath, ['diff', '--name-only', target.sha]).catch(() => '')))

  const session: IsolationFoldSession = {
    id: input.panelId,
    runId: input.panelId,
    panelId: input.panelId,
    kind: input.kind,
    title: input.title,
    branch,
    agentWorktreePath: input.worktreePath,
    integrationPath,
    integrationBranch,
    targetBranch: target.branch,
    baseSha: target.sha,
    targetSha: target.sha,
    stale: false,
    status,
    files: files.length > 0 ? files : changed,
    conflicts
  }
  foldByRepo.set(repoRoot, session)
  const state = await loadRepoIsolation(repoRoot, baseDir)
  upsertAgentRun(state, {
    id: input.panelId,
    kind: input.kind,
    title: input.title,
    branch,
    worktreePath: input.worktreePath,
    targetBranch: target.branch,
    baseSha: target.sha,
    isolationPolicy: 'isolated',
    status: status === 'conflict' ? 'conflict' : 'queued',
    attachedPanelId: input.panelId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
  state.targetBranch = target.branch
  state.targetSha = target.sha
  state.fold = session
  await saveRepoIsolation(state, baseDir)
  return session
}

export async function syncFold(input: {
  projectRoot: string
  baseDir?: string
}): Promise<IsolationFoldSession> {
  const repoRoot = await resolveRepoRoot(input.projectRoot)
  const session = foldByRepo.get(repoRoot) ?? (await loadRepoIsolation(repoRoot, worktreeBaseDir(input.baseDir))).fold
  if (!session) {
    throw new Error('Nothing to sync')
  }
  return prepareFold({
    projectRoot: repoRoot,
    panelId: session.panelId,
    kind: session.kind,
    title: session.title,
    worktreePath: session.agentWorktreePath,
    baseDir: input.baseDir
  })
}

async function finishIntegrationMerge(session: IsolationFoldSession): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!session.integrationPath) return { ok: false, error: 'Nothing to accept' }
  if (session.status === 'conflict' || (await mergeHeadPresent(session.integrationPath))) {
    await stageResolvedConflicts(session.integrationPath)
    const still = await listUnmerged(session.integrationPath)
    if (still.length > 0) {
      await refreshFoldSession(session, session.targetSha)
      return { ok: false, error: `${still.length} conflicted file${still.length === 1 ? '' : 's'} remain` }
    }
    if (await mergeHeadPresent(session.integrationPath)) {
      await runGit(session.integrationPath, ['add', '-A']).catch(() => undefined)
      try {
        await runGit(session.integrationPath, [
          '-c',
          'user.email=bikorch@local',
          '-c',
          'user.name=Bikorch',
          'commit',
          '--no-edit'
        ])
      } catch {
        await runGit(session.integrationPath, [
          '-c',
          'user.email=bikorch@local',
          '-c',
          'user.name=Bikorch',
          'commit',
          '-m',
          foldCommitMessage(session.title)
        ])
      }
    }
  }
  return { ok: true }
}

export async function acceptFold(input: {
  projectRoot: string
  baseDir?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const repoRoot = await resolveRepoRoot(input.projectRoot)
  const baseDir = worktreeBaseDir(input.baseDir)
  const session = foldByRepo.get(repoRoot) ?? (await loadRepoIsolation(repoRoot, baseDir)).fold
  if (!session || !session.integrationPath || !session.integrationBranch) {
    return { ok: false, error: 'Nothing to accept' }
  }
  foldByRepo.set(repoRoot, session)

  const liveSha = await headSha(repoRoot)
  markStale(session, liveSha)
  if (session.stale) {
    await persistState(repoRoot, baseDir, session)
    return { ok: false, error: `Target ${session.targetBranch} moved since this review. Sync before accepting.` }
  }

  const onTarget = (await currentBranch(repoRoot)) ?? 'main'
  if (onTarget !== session.targetBranch) {
    return { ok: false, error: `Switch to ${session.targetBranch} before accepting` }
  }

  const finished = await finishIntegrationMerge(session)
  if (!finished.ok) return finished

  if (await isWorkingTreeDirty(repoRoot)) {
    return { ok: false, error: 'Commit or stash changes on the target branch before accepting' }
  }

  try {
    await runGit(repoRoot, ['merge', '--squash', session.integrationBranch])
    if (await isWorkingTreeDirty(repoRoot)) {
      const message = foldCommitMessage(session.title)
      try {
        await runGit(repoRoot, ['commit', '-m', message])
      } catch {
        await runGit(repoRoot, [
          '-c',
          'user.email=bikorch@local',
          '-c',
          'user.name=Bikorch',
          'commit',
          '-m',
          message
        ])
      }
    }
  } catch (error) {
    await runGit(repoRoot, ['reset', '--merge']).catch(() => undefined)
    return { ok: false, error: error instanceof Error ? error.message : 'Squash into target failed' }
  }

  await abortFold({ projectRoot: repoRoot, baseDir: input.baseDir })
  return { ok: true }
}

export async function abortFold(input: {
  projectRoot: string
  baseDir?: string
}): Promise<{ ok: true }> {
  const repoRoot = await resolveRepoRoot(input.projectRoot)
  const baseDir = worktreeBaseDir(input.baseDir)
  const session = foldByRepo.get(repoRoot) ?? (await loadRepoIsolation(repoRoot, baseDir)).fold
  if (session?.integrationPath && isManagedWorktreePath(baseDir, session.integrationPath)) {
    await runGit(session.integrationPath, ['merge', '--abort']).catch(() => undefined)
    await runGit(repoRoot, ['worktree', 'remove', '--force', session.integrationPath]).catch(async () => {
      await rm(session.integrationPath!, { recursive: true, force: true })
      await runGit(repoRoot, ['worktree', 'prune']).catch(() => undefined)
    })
  }
  if (session?.integrationBranch) {
    await runGit(repoRoot, ['branch', '-D', session.integrationBranch]).catch(() => undefined)
  }
  foldByRepo.delete(repoRoot)
  await persistState(repoRoot, baseDir, null)
  return { ok: true }
}

export async function foldFileDiff(input: {
  projectRoot: string
  filePath: string
  baseDir?: string
}): Promise<GitDiffResponse> {
  const repoRoot = await resolveRepoRoot(input.projectRoot)
  const session =
    foldByRepo.get(repoRoot) ?? (await loadRepoIsolation(repoRoot, worktreeBaseDir(input.baseDir))).fold
  if (!session?.integrationPath) {
    throw new Error('Nothing to review')
  }
  const relativePath = safeRelativePath(input.filePath)
  const original = await runGit(repoRoot, ['show', `HEAD:${relativePath}`]).catch(() => '')
  let modified = ''
  try {
    const buffer = await readFile(join(session.integrationPath, relativePath))
    if (!buffer.includes(0) && buffer.byteLength <= 2 * 1024 * 1024) {
      modified = buffer.toString('utf8')
    }
  } catch {
    modified = ''
  }
  return {
    original,
    modified,
    filePath: relativePath,
    language: detectLanguage(relativePath)
  }
}

export function getFold(projectRoot: string): IsolationFoldSession | null {
  return foldByRepo.get(resolve(projectRoot)) ?? null
}

export function clearFoldSessions(): void {
  foldByRepo.clear()
  clearRepoIsolationMemory()
}
