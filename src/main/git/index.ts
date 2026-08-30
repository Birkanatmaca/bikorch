import { spawn } from 'child_process'
import { constants } from 'fs'
import { access, readFile, readdir, rm } from 'fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'path'
import type {
  GitChange,
  GitChangeStatus,
  GitCommit,
  GitDiffResponse,
  GitRepoInfo
} from '@shared/contracts/git'
import { detectLanguage } from '@shared/lib/languages'
import { assertPathWithinRoot } from '../filesystem/path-guard'

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('error', (error) => {
      reject(error)
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(new Error(stderr.trim() || `git exited with code ${code}`))
    })
  })
}

async function isGitRepo(projectRoot: string): Promise<boolean> {
  try {
    await runGit(projectRoot, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

function unquoteGitPath(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed.replace(/\\/g, '/')
  }

  const decoded = trimmed
    .slice(1, -1)
    .replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')

  return decoded.replace(/\\/g, '/')
}

function parsePorcelainLine(line: string): GitChange | null {
  if (line.length < 4) return null

  const indexStatus = line[0]
  const workTreeStatus = line[1]
  let filePath = unquoteGitPath(line.slice(3).trim())

  if (filePath.includes(' -> ')) {
    filePath = unquoteGitPath(filePath.split(' -> ').pop()?.trim() ?? filePath)
  }

  const staged = indexStatus !== ' ' && indexStatus !== '?'
  let status: GitChangeStatus

  if (indexStatus === '?' && workTreeStatus === '?') {
    status = 'U'
  } else if (indexStatus === 'D' || workTreeStatus === 'D') {
    status = 'D'
  } else if (indexStatus === 'A' || workTreeStatus === 'A') {
    status = 'A'
  } else if (indexStatus === 'M' || workTreeStatus === 'M' || indexStatus === 'R' || workTreeStatus === 'R') {
    status = 'M'
  } else {
    status = 'M'
  }

  return {
    path: filePath.replace(/\\/g, '/'),
    status,
    staged
  }
}

function sanitizeRemoteUrl(url: string): string {
  const trimmed = url.trim()
  return trimmed.replace(/^(https?:\/\/)([^/@]+)@/i, '$1')
}

async function detectRemote(
  projectRoot: string
): Promise<{ name: string | null; url: string | null }> {
  const names = await runGit(projectRoot, ['remote']).catch(() => '')
  const name = names.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
  if (!name) return { name: null, url: null }
  const url = (await runGit(projectRoot, ['remote', 'get-url', name]).catch(() => '')).trim()
  return { name, url: url ? sanitizeRemoteUrl(url) : null }
}

async function detectSync(
  projectRoot: string
): Promise<{ upstream: string | null; ahead: number; behind: number }> {
  const upstream = (
    await runGit(projectRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(
      () => ''
    )
  ).trim()
  if (!upstream) return { upstream: null, ahead: 0, behind: 0 }

  const counts = (
    await runGit(projectRoot, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]).catch(
      () => ''
    )
  ).trim()
  const [behindRaw, aheadRaw] = counts.split(/\s+/)
  return {
    upstream,
    ahead: Number(aheadRaw) || 0,
    behind: Number(behindRaw) || 0
  }
}

function parseRecentCommits(raw: string): GitCommit[] {
  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, author, date, ...subjectParts] = record.split('\x1f')
      if (!hash || !shortHash || !author || !date || subjectParts.length === 0) return null
      return {
        hash,
        shortHash,
        author,
        date,
        subject: subjectParts.join('\x1f')
      }
    })
    .filter((commit): commit is GitCommit => commit !== null)
}

export async function getGitStatus(projectRoot: string): Promise<{
  changes: GitChange[]
  branch: string | null
  branches: string[]
  recentCommits: GitCommit[]
  isRepo: boolean
  remoteName: string | null
  remoteUrl: string | null
  upstream: string | null
  ahead: number
  behind: number
}> {
  const empty = {
    changes: [],
    branch: null,
    branches: [],
    recentCommits: [],
    isRepo: false,
    remoteName: null,
    remoteUrl: null,
    upstream: null,
    ahead: 0,
    behind: 0
  }

  const repo = await isGitRepo(projectRoot)
  if (!repo) return empty

  const [statusOutput, branchOutput, remote, sync, branchesOutput, commitLog] = await Promise.all([
    runGit(projectRoot, ['-c', 'core.quotepath=false', 'status', '--porcelain']),
    runGit(projectRoot, ['branch', '--show-current']).catch(() => ''),
    detectRemote(projectRoot),
    detectSync(projectRoot),
    runGit(projectRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).catch(() => ''),
    runGit(projectRoot, [
      'log',
      '-n',
      '8',
      '--date=iso-strict',
      '--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e'
    ]).catch(() => '')
  ])

  const changesMap = new Map<string, GitChange>()

  for (const line of statusOutput.split('\n')) {
    const trimmed = line.trimEnd()
    if (!trimmed) continue

    const change = parsePorcelainLine(trimmed)
    if (!change) continue

    const existing = changesMap.get(change.path)
    if (existing) {
      changesMap.set(change.path, {
        ...change,
        staged: existing.staged || change.staged
      })
    } else {
      changesMap.set(change.path, change)
    }
  }

  const changes = Array.from(changesMap.values()).sort((a, b) => a.path.localeCompare(b.path))
  const branches = branchesOutput
    .split(/\r?\n/)
    .map((branch) => branch.trim())
    .filter(Boolean)

  return {
    changes,
    branch: branchOutput.trim() || null,
    branches,
    recentCommits: parseRecentCommits(commitLog),
    isRepo: true,
    remoteName: remote.name,
    remoteUrl: remote.url,
    upstream: sync.upstream,
    ahead: sync.ahead,
    behind: sync.behind
  }
}

export async function checkoutGitBranch(projectRoot: string, branch: string): Promise<void> {
  const branchesOutput = await runGit(projectRoot, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads/'
  ])
  const branches = branchesOutput
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (!branches.includes(branch)) {
    throw new Error('Branch is not available in this repository')
  }

  await runGit(projectRoot, ['checkout', branch])
}

const MAX_DIFF_BYTES = 2 * 1024 * 1024

async function resolveRepoRoot(cwd: string): Promise<string> {
  const toplevel = (await runGit(cwd, ['rev-parse', '--show-toplevel']).catch(() => '')).trim()
  return toplevel || cwd
}

function toRepoRelativePath(repoRoot: string, filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (!isAbsolute(filePath) && !/^[A-Za-z]:[\\/]/.test(filePath)) {
    return normalized.replace(/^\.\//, '')
  }

  const relativePath = relative(resolve(repoRoot), resolve(filePath)).replace(/\\/g, '/')
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return normalized
  }
  return relativePath
}

function decodeTextBuffer(buffer: Buffer): { text: string; binary: boolean; tooLarge: boolean } {
  if (buffer.includes(0)) {
    return { text: '', binary: true, tooLarge: false }
  }
  if (buffer.byteLength > MAX_DIFF_BYTES) {
    return { text: '', binary: false, tooLarge: true }
  }
  return { text: buffer.toString('utf8'), binary: false, tooLarge: false }
}

function unavailableMessage(kind: 'binary' | 'tooLarge'): string {
  return kind === 'binary'
    ? 'Binary file — content cannot be shown in the diff viewer.'
    : 'File is too large to show in the diff viewer.'
}

async function readGitFile(repoRoot: string, relativePath: string): Promise<string> {
  try {
    return await runGit(repoRoot, ['show', `HEAD:${relativePath}`])
  } catch {
    return ''
  }
}

async function readWorkingTreeFile(repoRoot: string, relativePath: string): Promise<string> {
  const absolutePath = assertPathWithinRoot(repoRoot, join(repoRoot, relativePath))
  const buffer = await readFile(absolutePath)
  const decoded = decodeTextBuffer(buffer)
  if (decoded.binary) return unavailableMessage('binary')
  if (decoded.tooLarge) return unavailableMessage('tooLarge')
  return decoded.text
}

export async function getFileDiff(
  projectRoot: string,
  filePath: string,
  status: GitChangeStatus
): Promise<GitDiffResponse> {
  const repoRoot = await resolveRepoRoot(projectRoot)
  const relativePath = toRepoRelativePath(repoRoot, filePath)
  const language = detectLanguage(relativePath)

  let original = ''
  let modified = ''

  if (status === 'D') {
    original = await readGitFile(repoRoot, relativePath)
    modified = ''
  } else if (status === 'A' || status === 'U') {
    original = ''
    modified = await readWorkingTreeFile(repoRoot, relativePath)
  } else {
    original = await readGitFile(repoRoot, relativePath)
    modified = await readWorkingTreeFile(repoRoot, relativePath)
  }

  return {
    original,
    modified,
    filePath: relativePath,
    language
  }
}

function assertSafeRepoFile(repoRoot: string, relativePath: string): string {
  const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!clean || clean === '.' || clean.includes('\0') || clean.split('/').includes('..')) {
    throw new Error('Invalid file path')
  }
  if (clean === '.git' || clean.startsWith('.git/')) {
    throw new Error('Cannot modify git internals')
  }
  return assertPathWithinRoot(repoRoot, join(repoRoot, clean))
}

export async function discardFileChange(
  projectRoot: string,
  filePath: string,
  status: GitChangeStatus
): Promise<void> {
  const repoRoot = await resolveRepoRoot(projectRoot)
  const relativePath = toRepoRelativePath(repoRoot, filePath)
  const absolutePath = assertSafeRepoFile(repoRoot, relativePath)

  if (status === 'U') {
    await rm(absolutePath, { recursive: true, force: true })
    return
  }

  try {
    await runGit(repoRoot, [
      'restore',
      '--source=HEAD',
      '--staged',
      '--worktree',
      '--',
      relativePath
    ])
  } catch {
    await runGit(repoRoot, ['reset', 'HEAD', '--', relativePath]).catch(() => undefined)
    await runGit(repoRoot, ['checkout', 'HEAD', '--', relativePath])
  }
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target',
  '.next',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__'
])

async function isGitRoot(dir: string): Promise<boolean> {
  try {
    await access(join(dir, '.git'), constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function discoverGitRepos(projectRoot: string): Promise<GitRepoInfo[]> {
  const repos: GitRepoInfo[] = []

  if (await isGitRoot(projectRoot)) {
    repos.push({
      name: basename(projectRoot),
      root: projectRoot,
      isWorkspaceRoot: true
    })
  }

  const entries = await readdir(projectRoot, { withFileTypes: true }).catch(() => null)
  if (!entries) return repos

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (SKIP_DIRS.has(entry.name) || entry.name === '.git' || entry.name.startsWith('.')) {
      continue
    }
    const child = join(projectRoot, entry.name)
    if (await isGitRoot(child)) {
      repos.push({
        name: entry.name,
        root: child,
        isWorkspaceRoot: false
      })
    }
  }

  repos.sort((a, b) => {
    if (a.isWorkspaceRoot !== b.isWorkspaceRoot) return a.isWorkspaceRoot ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return repos
}
