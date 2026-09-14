import { app } from 'electron'
import { mkdir, readFile, rm } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import type {
  AgentApplyPhase,
  AgentRunRecord,
  AgentRunRecovery,
  GitDiffResponse,
  IsolationConflictFile,
  IsolationFoldSession,
  IsolationInspectRequest,
  IsolationInspectResponse,
  IsolationLane,
  IsolationOverlap,
  IsolationProjectRequest,
  MergeQueueItem,
  WorktreeProvisionRequest,
  WorktreeProvisionSettings,
  WorktreeSetupFailure
} from '@shared/contracts/git'
import { parseWorktreeProvision } from '@shared/contracts/git'
import { summarizeChangedWork } from '@shared/lib/agent-work-summary'
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
  isFoldingAgentRunStatus,
  isTerminalAgentRunStatus,
  normalizeAgentRunStatus
} from './agent-lifecycle'
import { reconcileAgentRuns } from './reconcile'
import { runIsolationValidation } from './validation'
import { listPresentWorktreeLocalFiles, provisionWorktree } from './worktree-setup'
import {
  agentBranchName,
  buildIntegrationWorktreePath,
  canonicalRepoRoot,
  integrationBranchName,
  isManagedWorktreePath
} from './worktree-paths'

const MAX_SNIPPET = 1_500
const MAX_WORKING_BYTES = 2 * 1024 * 1024
const foldByRepo = new Map<string, IsolationFoldSession>()

export type ApplyProgressCallback = (phase: AgentApplyPhase, panelId: string) => void

function worktreeBaseDir(override?: string): string {
  return override ?? app.getPath('userData')
}

async function repoKey(projectRoot: string): Promise<string> {
  return canonicalRepoRoot(await resolveRepoRoot(projectRoot))
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

async function listCommitSubjects(worktreePath: string, baseSha: string): Promise<string[]> {
  if (!baseSha) return []
  const raw = await runGit(worktreePath, ['log', '--format=%s', '-n', '8', `${baseSha}..HEAD`]).catch(() => '')
  return lines(raw)
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
  const branch = (await currentBranch(repoRoot)) ?? 'HEAD'
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
      session.conflictsVerified = true
    }
    return session
  }
  session.status = 'conflict'
  session.files = unmerged
  session.conflicts = []
  for (const file of unmerged) {
    const currentTarget = await showStage(session.integrationPath, 2, file)
    const incoming = await showStage(session.integrationPath, 3, file)
    session.conflicts.push({
      path: file,
      absolutePath: join(session.integrationPath, file),
      base: await showStage(session.integrationPath, 1, file),
      currentTarget,
      incoming,
      main: currentTarget,
      agent: incoming
    })
  }
  session.conflictsVerified = false
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
      summary: [],
      targetBranch: input.run.targetBranch,
      baseSha: input.run.baseSha,
      isolationPolicy: input.run.isolationPolicy,
      isolationState: 'missing',
      attached: input.attached,
      runStatus: normalizeAgentRunStatus(input.run.status),
      writerLocked: Boolean(input.run.writerSessionId)
    }
  }
  const files = input.targetSha ? await listChangedFiles(input.worktreePath, input.targetSha) : []
  const branch = (await currentBranch(input.worktreePath)) ?? agentBranchName(input.kind, input.panelId)
  const baseSha = input.run?.baseSha ?? input.targetSha
  const subjects = await listCommitSubjects(input.worktreePath, baseSha)
  return {
    panelId: input.panelId,
    runId: input.run?.id ?? input.panelId,
    kind: input.kind,
    title: input.title,
    worktreePath: input.worktreePath,
    branch,
    files,
    summary: summarizeChangedWork(files, subjects),
    targetBranch: input.run?.targetBranch ?? input.targetBranch,
    baseSha,
    isolationPolicy: input.run?.isolationPolicy ?? 'isolated',
    isolationState: input.attached ? 'ready' : 'parked',
    attached: input.attached,
    runStatus: normalizeAgentRunStatus(input.run?.status ?? (input.attached ? 'running' : 'interrupted')),
    writerLocked: Boolean(input.run?.writerSessionId && input.run.writerSessionId !== input.panelId)
  }
}

export { buildConflictResolvePrompt }

function recoveriesFrom(lanes: IsolationLane[], fold: IsolationFoldSession | null): AgentRunRecovery[] {
  const items: AgentRunRecovery[] = []
  const folded = new Set<string>()
  if (fold && fold.status !== 'empty') {
    folded.add(fold.panelId)
    items.push({
      runId: fold.runId,
      title: fold.title,
      kind: fold.kind,
      status: fold.status === 'conflict' ? 'conflict' : 'awaiting-review',
      reason: fold.stale
        ? 'Target moved since this review'
        : fold.status === 'conflict'
          ? 'Merge conflict in the integration worktree'
          : 'Ready for review',
      actions: ['review', 'discard']
    })
  }
  for (const lane of lanes) {
    if (folded.has(lane.panelId)) continue
    if (lane.attached && lane.isolationState === 'ready') continue
    items.push({
      runId: lane.runId,
      title: lane.title,
      kind: lane.kind,
      status: lane.runStatus === 'parked' ? 'parked' : 'interrupted',
      reason: 'Unmerged agent work with no live CLI session',
      actions: ['resume', 'discard']
    })
  }
  return items
}

export async function inspectIsolation(
  request: IsolationInspectRequest
): Promise<IsolationInspectResponse> {
  const repoRoot = await repoKey(request.projectRoot)
  const baseDir = worktreeBaseDir(request.baseDir)
  await reconcileAgentRuns({
    projectRoot: repoRoot,
    baseDir,
    livePanelIds: request.lanes.map((lane) => lane.panelId)
  })
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
      const keepFold = run && isFoldingAgentRunStatus(normalizeAgentRunStatus(run.status))
      upsertAgentRun(state, {
        id: lane.runId,
        kind: lane.kind,
        title: lane.title,
        branch: lane.branch,
        worktreePath: lane.worktreePath,
        targetBranch: lane.targetBranch,
        baseSha: lane.baseSha,
        isolationPolicy: run?.isolationPolicy ?? 'isolated',
        status: keepFold && run ? normalizeAgentRunStatus(run.status) : 'running',
        attachedPanelId: lane.panelId,
        writerSessionId: lane.panelId,
        createdAt: run?.createdAt ?? Date.now(),
        updatedAt: Date.now()
      })
    }
  }

  for (const run of state.runs) {
    if (attachedIds.has(run.id)) continue
    const status = normalizeAgentRunStatus(run.status)
    if (isTerminalAgentRunStatus(status)) continue
    if (run.isolationPolicy === 'shared') continue
    if (!isFoldingAgentRunStatus(status) && status === 'running') {
      run.status = 'interrupted'
      run.writerSessionId = null
    }
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
    if (lane && (lane.files.length > 0 || lane.isolationState !== 'missing' || isFoldingAgentRunStatus(status))) {
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
  state.provision = parseWorktreeProvision(state.provision)
  await saveRepoIsolation(state, baseDir)

  return {
    lanes,
    overlaps: overlapsFromLanes(lanes),
    fold,
    queue: queueFrom(lanes, fold),
    recoveries: recoveriesFrom(lanes, fold),
    targetBranch: target.branch,
    targetSha: target.sha,
    provision: state.provision,
    availableLocalFiles: await listPresentWorktreeLocalFiles(repoRoot),
    setupError: state.setupError
  }
}

export async function updateWorktreeProvision(
  request: WorktreeProvisionRequest & { baseDir?: string }
): Promise<{
  ok: true
  provision: WorktreeProvisionSettings
  availableLocalFiles: IsolationInspectResponse['availableLocalFiles']
}> {
  const repoRoot = await repoKey(request.projectRoot)
  const baseDir = worktreeBaseDir(request.baseDir)
  const state = await loadRepoIsolation(repoRoot, baseDir)
  state.provision = parseWorktreeProvision({
    copyLocalFiles: request.copyLocalFiles,
    dependencyMode: request.dependencyMode
  })
  if (state.provision.dependencyMode !== 'setup') {
    state.setupError = null
  }
  await saveRepoIsolation(state, baseDir)
  return {
    ok: true,
    provision: state.provision,
    availableLocalFiles: await listPresentWorktreeLocalFiles(repoRoot)
  }
}

export async function retryWorktreeSetup(
  request: IsolationProjectRequest & { baseDir?: string }
): Promise<{ ok: boolean; setupError: WorktreeSetupFailure | null }> {
  const repoRoot = await repoKey(request.projectRoot)
  const baseDir = worktreeBaseDir(request.baseDir)
  const state = await loadRepoIsolation(repoRoot, baseDir)
  const provision = parseWorktreeProvision(state.provision)
  let failure: WorktreeSetupFailure | null = null
  for (const run of state.runs) {
    if (isTerminalAgentRunStatus(run.status)) continue
    if (!(await pathExists(run.worktreePath))) continue
    const result = await provisionWorktree(repoRoot, run.worktreePath, provision)
    if (!result.ok && !failure) failure = result.failure
  }
  state.setupError = failure
  await saveRepoIsolation(state, baseDir)
  return { ok: !failure, setupError: failure }
}

export async function prepareFold(input: {
  projectRoot: string
  panelId: string
  kind: IsolationLane['kind']
  title: string
  worktreePath: string
  baseDir?: string
  onPhase?: ApplyProgressCallback
}): Promise<IsolationFoldSession> {
  const repoRoot = await repoKey(input.projectRoot)
  const baseDir = worktreeBaseDir(input.baseDir)
  if (!isManagedWorktreePath(baseDir, input.worktreePath)) {
    throw new Error('Worktree path is not managed by Bikorch')
  }

  input.onPhase?.('preparing', input.panelId)
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
    await persistState(repoRoot, baseDir, null, { targetBranch: target.branch, targetSha: target.sha })
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

  input.onPhase?.('combining', input.panelId)
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
        const currentTarget = await showStage(integrationPath, 2, file)
        const incoming = await showStage(integrationPath, 3, file)
        conflict.base = await showStage(integrationPath, 1, file)
        conflict.currentTarget = currentTarget
        conflict.incoming = incoming
        conflict.main = currentTarget
        conflict.agent = incoming
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
    conflicts,
    conflictsVerified: status !== 'conflict'
  }
  if (status === 'clean' && session.integrationPath) {
    input.onPhase?.('validating', input.panelId)
    session.validation = await runIsolationValidation(session.integrationPath)
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
    isolationPolicy: state.runs.find((item) => item.id === input.panelId)?.isolationPolicy ?? 'isolated',
    status: status === 'conflict' ? 'conflict' : 'awaiting-review',
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
  onPhase?: ApplyProgressCallback
}): Promise<IsolationFoldSession> {
  const repoRoot = await repoKey(input.projectRoot)
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
    baseDir: input.baseDir,
    onPhase: input.onPhase
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
    for (const file of session.conflicts) {
      const text = await readWorkingText(file.absolutePath)
      if (hasConflictMarkers(text)) {
        return { ok: false, error: `${file.path} still has conflict markers` }
      }
    }
    session.conflictsVerified = true
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
  onPhase?: ApplyProgressCallback
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const repoRoot = await repoKey(input.projectRoot)
  const baseDir = worktreeBaseDir(input.baseDir)
  const session = foldByRepo.get(repoRoot) ?? (await loadRepoIsolation(repoRoot, baseDir)).fold
  if (!session || !session.integrationPath || !session.integrationBranch) {
    return { ok: false, error: 'Nothing to accept' }
  }
  input.onPhase?.('applying', session.panelId)
  foldByRepo.set(repoRoot, session)

  const liveSha = await headSha(repoRoot)
  markStale(session, liveSha)
  if (session.stale) {
    await persistState(repoRoot, baseDir, session)
    return { ok: false, error: `Target ${session.targetBranch} moved since this review. Sync before accepting.` }
  }

  const onTarget = (await currentBranch(repoRoot)) ?? session.targetBranch
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

  const state = await loadRepoIsolation(repoRoot, baseDir)
  const run = state.runs.find((item) => item.id === session.runId || item.id === session.panelId)
  if (run) {
    run.status = 'merged'
    run.writerSessionId = null
    run.attachedPanelId = run.attachedPanelId
    run.updatedAt = Date.now()
    await saveRepoIsolation(state, baseDir)
  }

  await abortFold({ projectRoot: repoRoot, baseDir: input.baseDir })
  return { ok: true }
}

export async function abortFold(input: {
  projectRoot: string
  baseDir?: string
}): Promise<{ ok: true }> {
  const repoRoot = await repoKey(input.projectRoot)
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
  const repoRoot = await repoKey(input.projectRoot)
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
