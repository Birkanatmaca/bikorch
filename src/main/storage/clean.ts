import { app } from 'electron'
import { chmod, lstat, readdir, rm, unlink } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import type { StorageCleanResult } from '@shared/contracts/storage'
import { isWorkingTreeDirty, pathExists, runGit } from '../git/git-exec'
import { listPersistedProjectFolders } from '../persistence/database'
import { clearBrowserCaches } from '../resources/disk'
import { scannedItem, sizeOf, type CleanPlan } from './scan'

/**
 * A path may be removed only when it sits at least two levels inside the home
 * folder and is not the home folder, the app data folder or a project itself.
 */
export function isRemovablePath(path: string, home = homedir(), protectedPaths: string[] = []): boolean {
  if (!isAbsolute(path) || resolve(path) !== path) return false
  const inside = relative(home, path)
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return false
  if (inside.split(sep).length < 2) return false
  return !protectedPaths.some((guarded) => resolve(guarded) === path)
}

/** Removes a folder; a symlink is unlinked without touching its target. */
async function removePath(path: string): Promise<void> {
  let info
  try {
    info = await lstat(path)
  } catch {
    return
  }
  if (info.isSymbolicLink()) {
    await unlink(path)
    return
  }
  await rm(path, { recursive: true, force: true, maxRetries: 2 })
}

async function removeContents(path: string): Promise<void> {
  for (const name of await readdir(path).catch(() => [] as string[])) await removePath(join(path, name))
}

/** Go marks its module cache read-only; make folders writable so they can go. */
async function makeFoldersWritable(root: string): Promise<void> {
  const pending = [root]
  while (pending.length) {
    const directory = pending.pop()!
    await chmod(directory, 0o755).catch(() => undefined)
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory()) pending.push(join(directory, entry.name))
    }
  }
}

function plannedPaths(plan: CleanPlan): string[] {
  if (plan.type === 'remove' || plan.type === 'worktrees') return plan.paths
  if (plan.type === 'contents' || plan.type === 'go-modcache') return [plan.path]
  return []
}

/** Returns the bytes freed when the cleaner reports them itself. */
async function runPlan(plan: CleanPlan): Promise<number | null> {
  if (plan.type === 'electron-cache') return clearBrowserCaches()
  const guarded = [app.getPath('userData'), ...listPersistedProjectFolders()]
  for (const path of plannedPaths(plan)) {
    if (!isRemovablePath(path, homedir(), guarded)) throw new Error(`Refusing to clean ${path}`)
  }
  if (plan.type === 'remove') {
    for (const path of plan.paths) await removePath(path)
  } else if (plan.type === 'contents') {
    await removeContents(plan.path)
  } else if (plan.type === 'go-modcache') {
    await makeFoldersWritable(plan.path)
    await removePath(plan.path)
  } else if (plan.type === 'worktrees') {
    for (const path of plan.paths) {
      // Re-check: the user may have edited the worktree since the scan.
      if (!(await pathExists(path)) || (await isWorkingTreeDirty(path).catch(() => true))) continue
      await runGit(plan.repoRoot, ['worktree', 'remove', path])
    }
    await runGit(plan.repoRoot, ['worktree', 'prune']).catch(() => undefined)
  }
  return null
}

async function remainingBytes(plan: CleanPlan): Promise<number> {
  const sizes = await Promise.all(plannedPaths(plan).map(async (path) => ((await pathExists(path)) ? sizeOf(path) : 0)))
  return sizes.reduce((sum, size) => sum + size, 0)
}

/** Cleans the chosen items one after another and reports what each freed. */
export async function cleanStorageItems(ids: unknown): Promise<StorageCleanResult[]> {
  if (!Array.isArray(ids)) throw new Error('Expected a list of storage items')
  const results: StorageCleanResult[] = []
  for (const id of ids.filter((value): value is string => typeof value === 'string').slice(0, 500)) {
    const scanned = scannedItem(id)
    if (!scanned) {
      results.push({ id, label: id, ok: false, freedBytes: 0, error: 'Scan again; this item is no longer in the list.' })
      continue
    }
    const { item, plan } = scanned
    try {
      const reported = await runPlan(plan)
      const freedBytes = reported ?? Math.max(0, item.bytes - (await remainingBytes(plan)))
      results.push({ id, label: item.label, ok: true, freedBytes })
    } catch (error) {
      results.push({ id, label: item.label, ok: false, freedBytes: 0, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
