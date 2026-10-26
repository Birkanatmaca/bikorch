import { execFile } from 'child_process'
import type { Dirent } from 'fs'
import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, join, relative, sep } from 'path'
import type { StorageSafety } from '@shared/contracts/storage'
import { GENERATED_DIRS, IGNORED_OUTPUT_DIRS, SKIP_WALK } from './locations'

export interface ProjectOutput {
  path: string
  name: string
  safety: StorageSafety
  detail: string
}

const MAX_DEPTH = 4
const MAX_DIRS = 2_500
const MARKERS = ['package.json', '.git', 'pubspec.yaml', 'go.mod', 'Cargo.toml', 'build.gradle', 'Podfile', 'pyproject.toml', 'requirements.txt']
const LAST_USED_MARKERS = ['.git/index', '.git/HEAD', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'pubspec.lock', 'go.sum']
/** Home folders that never hold projects worth walking. */
const SKIP_HOME_CHILDREN = new Set(['Library', 'Applications', 'Movies', 'Music', 'Pictures', 'Public', 'Downloads', 'go'])

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }, (_error, stdout) => resolve(String(stdout ?? '')))
  })
}

async function isGitRepo(root: string): Promise<boolean> {
  return (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
}

async function entries(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * Walks a project for generated folders without entering them. Build-output
 * names (dist, build, …) only count when Git ignores them and tracks nothing
 * inside, so a source folder called "build" is never offered.
 */
export async function findProjectOutputs(root: string): Promise<ProjectOutput[]> {
  const generated: string[] = []
  const outputs: string[] = []
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
  let visited = 0
  while (queue.length && visited < MAX_DIRS) {
    const { path, depth } = queue.shift()!
    visited += 1
    for (const entry of await entries(path)) {
      if (!entry.isDirectory()) continue
      const child = join(path, entry.name)
      if (entry.name in GENERATED_DIRS) generated.push(child)
      else if (entry.name in IGNORED_OUTPUT_DIRS) outputs.push(child)
      else if (!SKIP_WALK.has(entry.name) && !entry.name.startsWith('.') && depth + 1 < MAX_DEPTH) {
        queue.push({ path: child, depth: depth + 1 })
      }
    }
  }

  const repo = await isGitRepo(root)
  let allowed = new Set(generated)
  if (repo) {
    const relativeOf = (path: string): string => relative(root, path).split(sep).join('/')
    const ignored = new Set<string>()
    for (let index = 0; index < outputs.length; index += 50) {
      const chunk = outputs.slice(index, index + 50).map(relativeOf)
      for (const line of (await git(root, ['check-ignore', '--', ...chunk])).split('\n')) {
        if (line.trim()) ignored.add(line.trim().replace(/\/$/, ''))
      }
    }
    const candidates = [...generated, ...outputs.filter((path) => ignored.has(relativeOf(path)))]
    // A folder with tracked files is source, whatever its name.
    const tracked = new Set<string>()
    for (let index = 0; index < candidates.length; index += 50) {
      const chunk = candidates.slice(index, index + 50).map(relativeOf)
      const listed = await git(root, ['ls-files', '-z', '--', ...chunk])
      for (const file of listed.split('\0')) {
        const owner = chunk.find((dir) => file === dir || file.startsWith(`${dir}/`))
        if (owner) tracked.add(owner)
      }
    }
    allowed = new Set(candidates.filter((path) => !tracked.has(relativeOf(path))))
  }

  return [...allowed].map((path) => {
    const name = basename(path)
    const meta = GENERATED_DIRS[name] ?? IGNORED_OUTPUT_DIRS[name]
    return { path, name, safety: meta.safety, detail: meta.detail }
  })
}

/** The newest change to a project's lockfiles or Git index. */
export async function projectLastUsed(root: string): Promise<number | null> {
  let newest = 0
  for (const marker of LAST_USED_MARKERS) {
    try {
      newest = Math.max(newest, (await stat(join(root, marker))).mtimeMs)
    } catch {
      // Marker not present in this project.
    }
  }
  return newest || null
}

async function looksLikeProject(directory: string): Promise<boolean> {
  const names = new Set((await entries(directory)).map((entry) => entry.name))
  return MARKERS.some((marker) => names.has(marker))
}

/**
 * Projects next to the ones opened in Bikorch (same parent folder, or one level
 * below it, like ~/Projects/app). Most forgotten node_modules live there.
 */
export async function discoverNearbyProjects(registered: string[], home = homedir(), limit = 80): Promise<string[]> {
  const known = new Set(registered)
  const found: string[] = []
  const parents = [...new Set(registered.map((folder) => dirname(folder)))].filter((parent) => parent.startsWith(home))
  for (const parent of parents) {
    for (const entry of await entries(parent)) {
      if (found.length >= limit) return found
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      if (parent === home && SKIP_HOME_CHILDREN.has(entry.name)) continue
      const child = join(parent, entry.name)
      if (known.has(child)) continue
      if (await looksLikeProject(child)) {
        found.push(child)
        continue
      }
      for (const nested of await entries(child)) {
        if (found.length >= limit) return found
        if (!nested.isDirectory() || nested.name.startsWith('.')) continue
        const grandchild = join(child, nested.name)
        if (!known.has(grandchild) && (await looksLikeProject(grandchild))) found.push(grandchild)
      }
    }
  }
  return found
}
