import { readdir, readFile, stat } from 'fs/promises'
import { join, relative } from 'path'
import type { FileEntry } from '@shared/contracts/filesystem'
import { assertPathWithinRoot } from './path-guard'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.cache', 'coverage'])

const MAX_FILE_SIZE = 1024 * 1024 // 1MB

function compareEntries(a: FileEntry, b: FileEntry): number {
  if (a.type !== b.type) {
    return a.type === 'directory' ? -1 : 1
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

export async function listDirectory(projectRoot: string, directoryPath: string): Promise<FileEntry[]> {
  const resolvedDir = assertPathWithinRoot(projectRoot, directoryPath)
  const dirStat = await stat(resolvedDir)

  if (!dirStat.isDirectory()) {
    throw new Error('Path is not a directory')
  }

  const names = await readdir(resolvedDir)
  const entries: FileEntry[] = []

  for (const name of names) {
    if (name.startsWith('.') && name !== '.env.example') {
      continue
    }

    const fullPath = join(resolvedDir, name)
    const entryStat = await stat(fullPath)

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
  const resolvedFile = assertPathWithinRoot(projectRoot, filePath)
  const fileStat = await stat(resolvedFile)

  if (!fileStat.isFile()) {
    throw new Error('Path is not a file')
  }

  if (fileStat.size > MAX_FILE_SIZE) {
    throw new Error('File is too large to read')
  }

  return readFile(resolvedFile, 'utf-8')
}

const MAX_SEARCH_RESULTS = 80
const MAX_SEARCH_VISITS = 8000

export async function searchProjectFiles(
  projectRoot: string,
  query: string
): Promise<FileEntry[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const root = assertPathWithinRoot(projectRoot, projectRoot)
  const results: FileEntry[] = []
  let visited = 0

  const walk = async (dir: string): Promise<void> => {
    if (results.length >= MAX_SEARCH_RESULTS || visited >= MAX_SEARCH_VISITS) return

    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return
    }

    for (const name of names) {
      if (results.length >= MAX_SEARCH_RESULTS || visited >= MAX_SEARCH_VISITS) return
      if (name.startsWith('.') && name !== '.env.example') continue
      if (SKIP_DIRS.has(name)) continue

      visited += 1
      const fullPath = join(dir, name)
      const entryStat = await stat(fullPath).catch(() => null)
      if (!entryStat) continue

      if (entryStat.isDirectory()) {
        await walk(fullPath)
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

  await walk(root)
  return results
}
