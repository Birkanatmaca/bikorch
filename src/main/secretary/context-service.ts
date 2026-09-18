import { lstat, readdir, readFile, realpath } from 'fs/promises'
import { basename, join, relative } from 'path'
import type { SecretaryProjectRef } from '@shared/contracts/secretary'
import { scanProjectLanguages } from '../developer-intelligence/project-scan'
import { redactSecrets } from '../developer-intelligence/redaction'
import { getGitStatus } from '../git'
import { loadSnapshot } from '../persistence/database'

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.cache',
  '.next',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
  'target',
  'vendor',
  'venv'
])

const INSTRUCTION_FILES = ['AGENTS.md', 'CONTRIBUTING.md', 'README.md']
const MAX_TREE_ENTRIES = 250
const MAX_TREE_DEPTH = 4
const MAX_INSTRUCTION_CHARS = 4_000

export interface SecretaryProjectContext {
  project: {
    id: string
    name: string
    rootName: string | null
    available: boolean
  }
  git: {
    isRepository: boolean
    branch: string | null
    dirty: boolean
    changedPaths: string[]
    ahead: number
    behind: number
  }
  stack: {
    fileCount: number
    languages: Record<string, number>
    frameworks: string[]
    packageManager: string | null
    packageName: string | null
    scripts: string[]
  }
  instructions: Array<{ path: string; content: string }>
  tree: Array<{ path: string; kind: 'file' | 'directory' }>
  tasks: Array<{ title: string; status: string; priority: string }>
  warnings: string[]
}

function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === '.env' || lower.startsWith('.env.') || lower.endsWith('.pem') || lower.endsWith('.key')
}

function packageManagerFor(entries: string[]): string | null {
  if (entries.includes('pnpm-lock.yaml')) return 'pnpm'
  if (entries.includes('yarn.lock')) return 'yarn'
  if (entries.includes('package-lock.json')) return 'npm'
  if (entries.includes('bun.lockb') || entries.includes('bun.lock')) return 'bun'
  if (entries.includes('poetry.lock')) return 'poetry'
  if (entries.includes('uv.lock')) return 'uv'
  if (entries.includes('Cargo.lock')) return 'cargo'
  return null
}

async function readSafeInstruction(root: string, name: string): Promise<{ path: string; content: string } | null> {
  if (isSensitiveName(name)) return null
  const path = join(root, name)
  try {
    const entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 256 * 1024) return null
    const raw = await readFile(path, 'utf8')
    return {
      path: name,
      content: redactSecrets(raw).text.slice(0, MAX_INSTRUCTION_CHARS)
    }
  } catch {
    return null
  }
}

async function readPackageSummary(root: string): Promise<{ packageName: string | null; scripts: string[] }> {
  try {
    const entry = await lstat(join(root, 'package.json'))
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 512 * 1024) return { packageName: null, scripts: [] }
    const raw = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      name?: unknown
      scripts?: unknown
    }
    return {
      packageName: typeof raw.name === 'string' ? raw.name.slice(0, 160) : null,
      scripts: raw.scripts && typeof raw.scripts === 'object'
        ? Object.keys(raw.scripts as Record<string, unknown>).slice(0, 40)
        : []
    }
  } catch {
    return { packageName: null, scripts: [] }
  }
}

async function listTree(root: string): Promise<{ entries: Array<{ path: string; kind: 'file' | 'directory' }>; rootEntries: string[] }> {
  const entries: Array<{ path: string; kind: 'file' | 'directory' }> = []
  let rootEntries: string[] = []

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (entries.length >= MAX_TREE_ENTRIES || depth > MAX_TREE_DEPTH) return
    let children
    try {
      children = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    children.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    if (depth === 0) rootEntries = children.map((entry) => entry.name)

    for (const child of children) {
      if (entries.length >= MAX_TREE_ENTRIES) return
      if (child.isSymbolicLink() || isSensitiveName(child.name)) continue
      if (child.isDirectory() && SKIPPED_DIRECTORIES.has(child.name)) continue
      const path = join(directory, child.name)
      const relativePath = relative(root, path).replace(/\\/g, '/')
      if (!relativePath || relativePath.startsWith('..')) continue
      if (child.isDirectory()) {
        entries.push({ path: relativePath, kind: 'directory' })
        await walk(path, depth + 1)
      } else if (child.isFile()) {
        entries.push({ path: relativePath, kind: 'file' })
      }
    }
  }

  await walk(root, 0)
  return { entries, rootEntries }
}

function emptyContext(project: SecretaryProjectRef, warning: string): SecretaryProjectContext {
  return {
    project: { id: project.id, name: project.name, rootName: null, available: false },
    git: { isRepository: false, branch: null, dirty: false, changedPaths: [], ahead: 0, behind: 0 },
    stack: { fileCount: 0, languages: {}, frameworks: [], packageManager: null, packageName: null, scripts: [] },
    instructions: [],
    tree: [],
    tasks: [],
    warnings: [warning]
  }
}

/**
 * Builds a bounded, redacted, read-only project summary for Secretary planning.
 * It never follows symlinks, reads environment files, or returns absolute paths.
 */
export async function buildSecretaryProjectContext(project: SecretaryProjectRef): Promise<SecretaryProjectContext> {
  if (!project.folderPath) return emptyContext(project, 'This project has no folder attached.')

  let root: string
  try {
    root = await realpath(project.folderPath)
    const rootStat = await lstat(root)
    if (!rootStat.isDirectory()) return emptyContext(project, 'The project folder is not available.')
  } catch {
    return emptyContext(project, 'The project folder is not available.')
  }

  const [treeResult, census, gitStatus, packageSummary, savedSnapshot] = await Promise.all([
    listTree(root),
    scanProjectLanguages(root),
    getGitStatus(root).catch(() => null),
    readPackageSummary(root),
    Promise.resolve().then(() => loadSnapshot()).catch(() => null)
  ])
  const instructions = (await Promise.all(INSTRUCTION_FILES.map((name) => readSafeInstruction(root, name)))).filter(
    (item): item is { path: string; content: string } => Boolean(item)
  )
  const tasks = (savedSnapshot?.tasksByProject[project.id] ?? []).slice(0, 30).map((task) => ({
    title: redactSecrets(task.title).text.slice(0, 500),
    status: task.status,
    priority: task.priority
  }))

  return {
    project: { id: project.id, name: project.name, rootName: basename(root), available: true },
    git: gitStatus
      ? {
          isRepository: gitStatus.isRepo,
          branch: gitStatus.branch,
          dirty: gitStatus.changes.length > 0,
          changedPaths: gitStatus.changes.slice(0, 40).map((change) => change.path),
          ahead: gitStatus.ahead,
          behind: gitStatus.behind
        }
      : { isRepository: false, branch: null, dirty: false, changedPaths: [], ahead: 0, behind: 0 },
    stack: {
      fileCount: census.fileCount,
      languages: census.byLanguage,
      frameworks: census.frameworks.slice(0, 12),
      packageManager: packageManagerFor(treeResult.rootEntries),
      packageName: packageSummary.packageName,
      scripts: packageSummary.scripts
    },
    instructions,
    tree: treeResult.entries,
    tasks,
    warnings: treeResult.entries.length >= MAX_TREE_ENTRIES
      ? ['The project tree was truncated to a safe planning limit.']
      : []
  }
}
