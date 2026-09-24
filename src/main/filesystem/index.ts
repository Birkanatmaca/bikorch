import { constants } from 'fs'
import { lstat, open, readdir, realpath } from 'fs/promises'
import { join, relative } from 'path'
import type { FileEntry } from '@shared/contracts/filesystem'
import { assertPathWithinRoot, resolveExistingPathWithinRoot } from './path-guard'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.cache', 'coverage'])

const MAX_FILE_SIZE = 1024 * 1024 // 1MB
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0

async function openVerifiedFile(path: string, flags: number) {
  const expected = await lstat(path)
  if (expected.isSymbolicLink() || !expected.isFile()) {
    throw new Error('Path is not a file')
  }

  const handle = await open(path, flags | NO_FOLLOW)
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      expected.ino === 0 ||
      opened.ino === 0 ||
      opened.dev !== expected.dev ||
      opened.ino !== expected.ino
    ) {
      throw new Error('File changed while opening')
    }
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

function compareEntries(a: FileEntry, b: FileEntry): number {
  if (a.type !== b.type) {
    return a.type === 'directory' ? -1 : 1
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

export async function listDirectory(projectRoot: string, directoryPath: string): Promise<FileEntry[]> {
  const { resolvedPath, realPath } = await resolveExistingPathWithinRoot(projectRoot, directoryPath)
  const dirStat = await lstat(realPath)

  if (!dirStat.isDirectory()) {
    throw new Error('Path is not a directory')
  }

  const names = await readdir(realPath)
  const entries: FileEntry[] = []

  for (const name of names) {
    if (name.startsWith('.') && name !== '.env.example') {
      continue
    }

    const actualPath = join(realPath, name)
    const fullPath = join(resolvedPath, name)
    const entryStat = await lstat(actualPath)

    // Do not expose symlinks in the explorer; following them can escape the project.
    if (entryStat.isSymbolicLink()) continue

    if (entryStat.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      entries.push({ name, path: fullPath, type: 'directory' })
    } else if (entryStat.isFile()) {
      entries.push({ name, path: fullPath, type: 'file' })
    }
  }

  return entries.sort(compareEntries)
}

export async function readProjectFile(projectRoot: string, filePath: string): Promise<string> {
  const { realPath } = await resolveExistingPathWithinRoot(projectRoot, filePath)
  const handle = await openVerifiedFile(realPath, constants.O_RDONLY)
  try {
    const fileStat = await handle.stat()
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error('File is too large to read')
    }
    return await handle.readFile('utf-8')
  } finally {
    await handle.close()
  }
}

export async function writeProjectFile(
  projectRoot: string,
  filePath: string,
  content: string
): Promise<string> {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
    throw new Error('File is too large to write')
  }

  const { resolvedPath, realPath } = await resolveExistingPathWithinRoot(projectRoot, filePath)
  const handle = await openVerifiedFile(realPath, constants.O_WRONLY)
  try {
    await handle.truncate(0)
    await handle.writeFile(content, 'utf-8')
  } finally {
    await handle.close()
  }
  return resolvedPath
}

const MAX_SEARCH_RESULTS = 80
const MAX_SEARCH_VISITS = 8000

export async function searchProjectFiles(
  projectRoot: string,
  query: string
): Promise<FileEntry[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const { resolvedPath: root, realPath: realRoot } = await resolveExistingPathWithinRoot(projectRoot, projectRoot)
  const results: FileEntry[] = []
  let visited = 0

  const walk = async (dir: string, actualDir: string): Promise<void> => {
    if (results.length >= MAX_SEARCH_RESULTS || visited >= MAX_SEARCH_VISITS) return

    const canonicalDir = await realpath(actualDir).catch(() => null)
    if (!canonicalDir) return
    try {
      assertPathWithinRoot(realRoot, canonicalDir)
    } catch {
      return
    }

    let names: string[]
    try {
      names = await readdir(canonicalDir)
    } catch {
      return
    }

    for (const name of names) {
      if (results.length >= MAX_SEARCH_RESULTS || visited >= MAX_SEARCH_VISITS) return
      if (name.startsWith('.') && name !== '.env.example') continue
      if (SKIP_DIRS.has(name)) continue

      visited += 1
      const fullPath = join(dir, name)
      const actualPath = join(canonicalDir, name)
      const entryStat = await lstat(actualPath).catch(() => null)
      if (!entryStat) continue
      if (entryStat.isSymbolicLink()) continue

      if (entryStat.isDirectory()) {
        await walk(fullPath, actualPath)
        continue
      }

      if (!entryStat.isFile()) continue

      const relativePath = relative(root, fullPath).replace(/\\/g, '/')
      if (
        name.toLowerCase().includes(needle) ||
        relativePath.toLowerCase().includes(needle)
      ) {
        results.push({ name, path: fullPath, type: 'file' })
      }
    }
  }

  await walk(root, realRoot)
  return results
}
