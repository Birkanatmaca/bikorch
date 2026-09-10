import { spawn } from 'child_process'
import { app } from 'electron'
import { access, mkdir, readFile, rm } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import type {
  GitDiffResponse,
  IsolationConflictFile,
  IsolationFoldSession,
  IsolationInspectRequest,
  IsolationInspectResponse,
  IsolationLane,
  IsolationOverlap
} from '@shared/contracts/git'
import { detectLanguage } from '@shared/lib/languages'
import { buildConflictResolvePrompt } from '@shared/lib/isolation-prompt'
import {
  agentBranchName,
  buildIntegrationWorktreePath,
  integrationBranchName,
  isManagedWorktreePath
} from './worktree-paths'

const MAX_SNIPPET = 8_000
const foldByRepo = new Map<string, IsolationFoldSession>()

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('git', args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise(stdout)
        return
      }
      reject(new Error(stderr.trim() || stdout.trim() || `git exited with code ${code}`))
    })
  })
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function worktreeBaseDir(override?: string): string {
  return override ?? app.getPath('userData')
}

async function resolveRepoRoot(projectRoot: string): Promise<string> {
  const toplevel = (await runGit(projectRoot, ['rev-parse', '--show-toplevel']).catch(() => '')).trim()
  return toplevel || resolve(projectRoot)
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

async function currentBranch(cwd: string): Promise<string | null> {
  const name = (await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim()
  if (!name || name === 'HEAD') return null
  return name
}

async function commitLaneIfDirty(worktreePath: string, title: string): Promise<void> {
  await runGit(worktreePath, ['add', '-A']).catch(() => undefined)
  const dirty = (await runGit(worktreePath, ['status', '--porcelain']).catch(() => '')).trim().length > 0
  if (!dirty) return
  const message = `bikorch: ${title.trim().slice(0, 72) || 'agent work'}`
  try {
    await runGit(worktreePath, ['commit', '-m', message])
  } catch {
    await runGit(worktreePath, [
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

async function listUnmerged(cwd: string): Promise<string[]> {
  const raw = await runGit(cwd, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')
  return uniqueSorted(lines(raw))
}

async function showStage(cwd: string, stage: 1 | 2 | 3, file: string): Promise<string | undefined> {
  const text = await runGit(cwd, ['show', `:${stage}:${file}`]).catch(() => '')
  return text.length > 0 ? clip(text) : undefined
}

async function mergeHeadPresent(cwd: string): Promise<boolean> {
  const sha = (await runGit(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).catch(() => '')).trim()
  return sha.length > 0
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

export { buildConflictResolvePrompt }

export async function inspectIsolation(
  request: IsolationInspectRequest
): Promise<IsolationInspectResponse> {
  const repoRoot = await resolveRepoRoot(request.projectRoot)
  const mainHead = (await runGit(repoRoot, ['rev-parse', 'HEAD']).catch(() => '')).trim()
  const lanes: IsolationLane[] = []

  for (const input of request.lanes) {
    if (!(await exists(input.worktreePath))) continue
    const files = mainHead ? await listChangedFiles(input.worktreePath, mainHead) : []
    const branch = (await currentBranch(input.worktreePath)) ?? agentBranchName(input.kind, input.panelId)
    lanes.push({
      panelId: input.panelId,
      kind: input.kind,
      title: input.title,
      worktreePath: input.worktreePath,
      branch,
      files
    })
  }

  return {
    lanes,
    overlaps: overlapsFromLanes(lanes),
    fold: foldByRepo.get(repoRoot) ?? null
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

  const mainDirty = (await runGit(repoRoot, ['status', '--porcelain']).catch(() => '')).trim()
  if (mainDirty.length > 0) {
    throw new Error('Commit or stash changes on main before folding an agent')
  }

  await commitLaneIfDirty(input.worktreePath, input.title)
  const branch = (await currentBranch(input.worktreePath)) ?? agentBranchName(input.kind, input.panelId)
  const changed = uniqueSorted(lines(await runGit(repoRoot, ['diff', '--name-only', 'HEAD', branch]).catch(() => '')))
  if (changed.length === 0) {
    return {
      id: input.panelId,
      panelId: input.panelId,
      kind: input.kind,
      title: input.title,
      branch,
      agentWorktreePath: input.worktreePath,
      status: 'empty',
      files: [],
      conflicts: []
    }
  }

  const existing = foldByRepo.get(repoRoot)
  if (existing) await abortFold({ projectRoot: repoRoot, baseDir })

  const mainHead = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim()
  const integrationPath = buildIntegrationWorktreePath(baseDir, repoRoot, input.panelId)
  const integrationBranch = integrationBranchName(input.panelId)
  if (await exists(integrationPath)) {
    await runGit(repoRoot, ['worktree', 'remove', '--force', integrationPath]).catch(async () => {
      await rm(integrationPath, { recursive: true, force: true })
      await runGit(repoRoot, ['worktree', 'prune']).catch(() => undefined)
    })
  }
  await runGit(repoRoot, ['branch', '-D', integrationBranch]).catch(() => undefined)
  await mkdir(dirname(integrationPath), { recursive: true })
  await runGit(repoRoot, ['worktree', 'add', '-b', integrationBranch, integrationPath])

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
      conflicts.push({
        path: file,
        absolutePath: join(integrationPath, file),
        base: await showStage(integrationPath, 1, file),
        main: await showStage(integrationPath, 2, file),
        agent: await showStage(integrationPath, 3, file)
      })
    }
  }

  const files =
    status === 'conflict'
      ? conflicts.map((file) => file.path)
      : uniqueSorted(lines(await runGit(integrationPath, ['diff', '--name-only', mainHead]).catch(() => '')))

  const session: IsolationFoldSession = {
    id: input.panelId,
    panelId: input.panelId,
    kind: input.kind,
    title: input.title,
    branch,
    agentWorktreePath: input.worktreePath,
    integrationPath,
    integrationBranch,
    status,
    files: files.length > 0 ? files : changed,
    conflicts
  }
  foldByRepo.set(repoRoot, session)
  return session
}

export async function acceptFold(input: {
  projectRoot: string
  baseDir?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const repoRoot = await resolveRepoRoot(input.projectRoot)
  const session = foldByRepo.get(repoRoot)
  if (!session || !session.integrationPath || !session.integrationBranch) {
    return { ok: false, error: 'Nothing to accept' }
  }

  if (session.status === 'conflict') {
    const still = await listUnmerged(session.integrationPath)
    if (still.length > 0) {
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
          `bikorch: resolve ${session.title}`
        ])
      }
    }
  }

  const mainDirty = (await runGit(repoRoot, ['status', '--porcelain']).catch(() => '')).trim()
  if (mainDirty.length > 0) {
    return { ok: false, error: 'Commit or stash changes on main before accepting' }
  }

  try {
    await runGit(repoRoot, ['merge', '--no-edit', session.integrationBranch])
  } catch (error) {
    await runGit(repoRoot, ['merge', '--abort']).catch(() => undefined)
    return { ok: false, error: error instanceof Error ? error.message : 'Merge into main failed' }
  }

  await abortFold({ projectRoot: repoRoot, baseDir: input.baseDir })
  return { ok: true }
}

export async function abortFold(input: {
  projectRoot: string
  baseDir?: string
}): Promise<{ ok: true }> {
  const repoRoot = await resolveRepoRoot(input.projectRoot)
  const session = foldByRepo.get(repoRoot)
  const baseDir = worktreeBaseDir(input.baseDir)
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
  return { ok: true }
}

export async function foldFileDiff(input: {
  projectRoot: string
  filePath: string
}): Promise<GitDiffResponse> {
  const repoRoot = await resolveRepoRoot(input.projectRoot)
  const session = foldByRepo.get(repoRoot)
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
}
