import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { app } from 'electron'
import type { Dirent } from 'fs'
import { readdir, realpath, stat, statfs } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, join, relative } from 'path'
import type { StorageGroup, StorageItem, StorageReport, StorageSafety } from '@shared/contracts/storage'
import { mainRepositoryOf } from '../accounts/workspace-trust'
import { loadRepoIsolation } from '../git/agent-run-store'
import { isTerminalAgentRunStatus } from '../git/agent-lifecycle'
import { isWorkingTreeDirty, pathExists, tryRepoRoot } from '../git/git-exec'
import { hashRepoRoot } from '../git/worktree-paths'
import { listPersistedProjectFolders } from '../persistence/database'
import { directoryBytes, measureClearableCacheParts } from '../resources/disk'
import { TOOL_CACHES, appliesTo, coveredCacheFolders, toolCachePath } from './locations'
import { discoverNearbyProjects, findProjectOutputs, projectLastUsed } from './projects'

/** How an item is cleaned. Paths come from the scan, never from the renderer. */
export type CleanPlan =
  | { type: 'remove'; paths: string[] }
  | { type: 'contents'; path: string }
  | { type: 'go-modcache'; path: string }
  | { type: 'electron-cache' }
  | { type: 'worktrees'; repoRoot: string; paths: string[] }

export interface ScannedItem {
  item: StorageItem
  plan: CleanPlan
}

/** Items under this size are noise in the list. */
const MIN_ITEM_BYTES = 1024 * 1024
const MIN_APP_CACHE_BYTES = 50 * 1024 * 1024
const SIZE_CONCURRENCY = 4
/** Claude Code deletes conversations after 30 days itself; these are the ones it still keeps. */
export const OLD_CONVERSATION_DAYS = 14
const DAY_MS = 86_400_000
const CONVERSATION_ENTRY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.jsonl)?$/i

let lastScan = new Map<string, ScannedItem>()
let running: Promise<StorageReport> | null = null
let lastReport: StorageReport | null = null

/** The most recent finished scan, if any. */
export function latestStorageReport(): StorageReport | null {
  return lastReport
}

export function scannedItem(id: string): ScannedItem | undefined {
  return lastScan.get(id)
}

function idFor(prefix: string, path: string): string {
  return `${prefix}:${createHash('sha1').update(path).digest('hex').slice(0, 12)}`
}

/** `du` is far faster than stat-walking node_modules from JavaScript. */
export function sizeOf(path: string): Promise<number> {
  if (process.platform === 'win32') return directoryBytes(path)
  return new Promise((resolve) => {
    execFile('du', ['-sk', path], { timeout: 120_000, maxBuffer: 1024 * 1024 }, (_error, stdout) => {
      const kb = Number.parseInt(String(stdout ?? ''), 10)
      resolve(Number.isFinite(kb) ? kb * 1024 : 0)
    })
  })
}

async function mtime(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return null
  }
}

async function entries(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index])
    }
  }))
  return results
}

interface Pending {
  id: string
  group: StorageGroup
  label: string
  detail: string
  path: string
  safety: StorageSafety
  plan: CleanPlan
  project?: string
  lastUsedAt?: number | null
  /** Measure these instead of `path` (worktree sets). */
  measure?: string[]
  bytes?: number
}

async function toolCacheItems(home: string): Promise<Pending[]> {
  const pending: Pending[] = []
  for (const location of TOOL_CACHES) {
    if (!appliesTo(location, process.platform)) continue
    const path = toolCachePath(home, location)
    if (!(await pathExists(path))) continue
    if (location.perChild) {
      for (const entry of await entries(path)) {
        if (!entry.isDirectory()) continue
        const child = join(path, entry.name)
        pending.push({
          id: idFor(`dev-${location.id}`, child),
          group: 'developer',
          label: `${location.label} · ${entry.name}`,
          detail: location.detail,
          path: child,
          safety: location.safety,
          plan: { type: 'remove', paths: [child] }
        })
      }
      continue
    }
    pending.push({
      id: `dev:${location.id}`,
      group: 'developer',
      label: location.label,
      detail: location.detail,
      path,
      safety: location.safety,
      plan: location.readOnly
        ? { type: 'go-modcache', path }
        : location.keepFolder ? { type: 'contents', path } : { type: 'remove', paths: [path] }
    })
  }
  return pending
}

async function appCacheItems(home: string): Promise<Pending[]> {
  if (process.platform !== 'darwin') return []
  const root = join(home, 'Library', 'Caches')
  const covered = coveredCacheFolders()
  const pending: Pending[] = []
  for (const entry of await entries(root)) {
    if (!entry.isDirectory() || covered.has(entry.name)) continue
    // Apple's own caches are managed by the system and often protected.
    if (entry.name.startsWith('com.apple.') || entry.name === 'CloudKit') continue
    const path = join(root, entry.name)
    pending.push({
      id: idFor('app', path),
      group: 'apps',
      label: entry.name,
      detail: 'Cache folder of another app. Quit that app first; it rebuilds the cache and may start slower once.',
      path,
      safety: 'caution',
      plan: { type: 'contents', path }
    })
  }
  return pending
}

async function bikorchItems(userData: string, projectFolders: string[]): Promise<Pending[]> {
  const pending: Pending[] = []
  const webParts = await measureClearableCacheParts().catch(() => [])
  pending.push({
    id: 'bikorch:web-cache',
    group: 'bikorch',
    label: 'Browser and chat caches',
    detail: 'HTTP and script caches of the built-in browser, ChatGPT and Claude panels. Sign-ins and cookies stay.',
    path: join(userData, 'Partitions'),
    safety: 'safe',
    plan: { type: 'electron-cache' },
    bytes: webParts.reduce((sum, part) => sum + part.bytes, 0),
    lastUsedAt: null
  })

  // Worktrees of finished agent runs with no unsaved changes.
  const repoHashes = new Set<string>()
  for (const folder of projectFolders) {
    const repoRoot = await tryRepoRoot(folder)
    if (!repoRoot) continue
    repoHashes.add(hashRepoRoot(repoRoot))
    const state = await loadRepoIsolation(repoRoot, userData).catch(() => null)
    if (!state) continue
    const finished: string[] = []
    for (const run of state.runs) {
      if (!(await pathExists(run.worktreePath))) continue
      const ended = isTerminalAgentRunStatus(run.status)
      if (ended && !(await isWorkingTreeDirty(run.worktreePath).catch(() => true))) {
        finished.push(run.worktreePath)
        continue
      }
      // A worktree that stays (unsaved changes, or still in use) can still shed its build output.
      pending.push(...(await worktreeOutputItems(repoRoot, run.worktreePath, ended)))
    }
    if (finished.length === 0) continue
    pending.push({
      id: idFor('bikorch-worktrees', repoRoot),
      group: 'bikorch',
      label: `Finished agent worktrees · ${basename(repoRoot)}`,
      detail: `${finished.length} worktree${finished.length === 1 ? '' : 's'} of merged or discarded agent runs, with no unsaved changes. Their branches stay in Git.`,
      path: join(userData, 'agent-worktrees', hashRepoRoot(repoRoot)),
      safety: 'safe',
      plan: { type: 'worktrees', repoRoot, paths: finished },
      measure: finished,
      project: basename(repoRoot)
    })
  }

  // Worktree folders of projects that are no longer open in Bikorch.
  const worktreeRoot = join(userData, 'agent-worktrees')
  for (const entry of await entries(worktreeRoot)) {
    if (!entry.isDirectory() || repoHashes.has(entry.name)) continue
    const path = join(worktreeRoot, entry.name)
    const slot = (await entries(path)).find((child) => child.isDirectory())
    const repo = slot ? mainRepositoryOf(join(path, slot.name)) : null
    pending.push({
      id: idFor('bikorch-orphan-worktrees', path),
      group: 'bikorch',
      label: `Worktrees of a removed project${repo ? ` · ${basename(repo)}` : ''}`,
      detail: 'Agent worktrees of a project you removed from Bikorch. Commit or copy anything you still need from them first.',
      path,
      safety: 'caution',
      plan: { type: 'remove', paths: [path] }
    })
  }

  // Account folders that no longer belong to an account (no profile.json).
  const profiles = join(userData, 'cli-profiles')
  for (const kind of await entries(profiles)) {
    if (!kind.isDirectory()) continue
    for (const entry of await entries(join(profiles, kind.name))) {
      if (!entry.isDirectory()) continue
      const path = join(profiles, kind.name, entry.name)
      if (await pathExists(join(path, 'profile.json'))) continue
      pending.push({
        id: idFor('bikorch-profile', path),
        group: 'bikorch',
        label: `Leftover ${kind.name} account folder`,
        detail: 'Left behind by a removed or unfinished sign-in. No account in Bikorch uses it.',
        path,
        safety: 'caution',
        plan: { type: 'remove', paths: [path] }
      })
    }
  }
  return pending
}

/** Build output and dependencies inside an agent worktree; the worktree and its changes stay. */
async function worktreeOutputItems(repoRoot: string, worktree: string, ended: boolean): Promise<Pending[]> {
  const outputs = await findProjectOutputs(worktree).catch(() => [])
  const lastUsedAt = await projectLastUsed(worktree).catch(() => null)
  return outputs.map((output) => ({
    id: idFor('bikorch-worktree-output', output.path),
    group: 'bikorch' as const,
    label: `Agent worktree · ${basename(repoRoot)} · ${relative(worktree, output.path)}`,
    detail: ended
      ? `${output.detail} It sits in a finished agent worktree (${basename(worktree)}) whose unsaved changes stay.`
      : `${output.detail} An agent may still be using this worktree (${basename(worktree)}); clean it once that agent is done.`,
    path: output.path,
    safety: ended ? output.safety : 'caution' as const,
    plan: { type: 'remove' as const, paths: [output.path] },
    project: basename(repoRoot),
    lastUsedAt
  }))
}

/** Conversation folders of Claude Code: the user's own and each Bikorch Claude account's. */
function conversationRoots(home: string, userData: string, profileIds: string[]): Array<{ id: string; label: string; path: string }> {
  return [
    { id: 'claude-home', label: 'Old Claude Code conversations', path: join(home, '.claude', 'projects') },
    ...profileIds.map((profile) => ({
      id: `claude-profile-${profile}`,
      label: 'Old Claude conversations in Bikorch',
      path: join(userData, 'cli-profiles', 'claude', profile, 'projects')
    }))
  ]
}

/**
 * Conversation logs (and their tool output folders) untouched for
 * OLD_CONVERSATION_DAYS. A conversation in use is written to, so it is never this old.
 */
export async function oldConversationItems(home: string, userData: string, now = Date.now()): Promise<Pending[]> {
  const profiles = (await entries(join(userData, 'cli-profiles', 'claude'))).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  const cutoff = now - OLD_CONVERSATION_DAYS * DAY_MS
  const pending: Pending[] = []
  for (const root of conversationRoots(home, userData, profiles)) {
    const stale: string[] = []
    let bytes = 0
    let newest = 0
    for (const project of await entries(root.path)) {
      if (!project.isDirectory()) continue
      for (const entry of await entries(join(root.path, project.name))) {
        // Only a conversation (<uuid>.jsonl) and its tool output folder (<uuid>/);
        // never memory/ or anything else Claude Code keeps next to them.
        if (!CONVERSATION_ENTRY_RE.test(entry.name)) continue
        const path = join(root.path, project.name, entry.name)
        const info = await stat(path).catch(() => null)
        if (!info || info.mtimeMs >= cutoff) continue
        stale.push(path)
        newest = Math.max(newest, info.mtimeMs)
        bytes += entry.isDirectory() ? await sizeOf(path) : info.size
      }
    }
    if (stale.length === 0) continue
    pending.push({
      id: idFor('claude-conversations', root.path),
      group: 'bikorch',
      label: root.label,
      detail: `${stale.length} conversation file${stale.length === 1 ? '' : 's'} untouched for ${OLD_CONVERSATION_DAYS}+ days. Claude Code deletes them after 30 days anyway; once gone they cannot be resumed.`,
      path: root.path,
      safety: 'caution',
      plan: { type: 'remove', paths: stale },
      bytes,
      lastUsedAt: newest || null
    })
  }
  return pending
}

/**
 * Claude Code keeps every version it updated to. The one ~/.local/bin/claude
 * runs and the newest stay; nothing is listed if the running one is unknown.
 */
export async function oldClaudeVersionItems(home: string): Promise<Pending[]> {
  if (process.platform === 'win32') return []
  // Compare real paths: the home folder itself may sit behind a symlink.
  const versions = await realpath(join(home, '.local', 'share', 'claude', 'versions')).catch(() => null)
  const current = await realpath(join(home, '.local', 'bin', 'claude')).catch(() => null)
  if (!versions || !current || dirname(current) !== versions) return []
  const all = await Promise.all(
    (await entries(versions)).map(async (entry) => {
      const path = join(versions, entry.name)
      return { path, name: entry.name, at: (await stat(path).catch(() => null))?.mtimeMs ?? 0 }
    })
  )
  const newest = all.reduce<(typeof all)[number] | null>((best, item) => (!best || item.at > best.at ? item : best), null)
  const old = all.filter((item) => item.path !== current && item.path !== newest?.path)
  if (old.length === 0) return []
  return [{
    id: 'dev:claude-code-versions',
    group: 'developer',
    label: 'Old Claude Code versions',
    detail: `${old.map((item) => item.name).join(', ')}. Claude Code keeps every version it updated to; the one in use (${basename(current)}) stays.`,
    path: versions,
    safety: 'safe',
    plan: { type: 'remove', paths: old.map((item) => item.path) },
    measure: old.map((item) => item.path),
    lastUsedAt: Math.max(...old.map((item) => item.at)) || null
  }]
}

/** "accesverifyer/mobile" says more than "mobile" when several projects share a name. */
function projectName(folder: string, home: string): string {
  const inside = relative(home, folder)
  return inside && !inside.startsWith('..') ? inside : basename(folder)
}

async function projectItems(folders: string[], nearby: boolean, home: string): Promise<Pending[]> {
  const pending: Pending[] = []
  for (const folder of folders) {
    const outputs = await findProjectOutputs(folder).catch(() => [])
    if (outputs.length === 0) continue
    const lastUsedAt = await projectLastUsed(folder)
    const project = projectName(folder, home)
    for (const output of outputs) {
      const relativePath = output.path.slice(folder.length + 1)
      pending.push({
        id: idFor('project', output.path),
        group: 'projects',
        label: `${project} · ${relativePath}`,
        detail: nearby ? `${output.detail} Project not opened in Bikorch.` : output.detail,
        path: output.path,
        safety: output.safety,
        plan: { type: 'remove', paths: [output.path] },
        project,
        lastUsedAt
      })
    }
  }
  return pending
}

function swapUsedBytes(): Promise<number | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('sysctl', ['-n', 'vm.swapusage'], { timeout: 5_000 }, (_error, stdout) => {
      const match = /used\s*=\s*([\d.]+)M/.exec(String(stdout ?? ''))
      resolve(match ? Math.round(Number(match[1]) * 1024 * 1024) : null)
    })
  })
}

async function diskSpace(path: string): Promise<StorageReport['disk']> {
  try {
    const info = await statfs(path)
    return { freeBytes: info.bavail * info.bsize, totalBytes: info.blocks * info.bsize }
  } catch {
    return null
  }
}

async function runScan(): Promise<StorageReport> {
  const started = Date.now()
  const home = homedir()
  const userData = app.getPath('userData')
  const registered = listPersistedProjectFolders()
  const nearby = await discoverNearbyProjects(registered).catch(() => [])

  const pending = [
    ...(await bikorchItems(userData, registered)),
    ...(await toolCacheItems(home)),
    ...(await oldClaudeVersionItems(home)),
    ...(await oldConversationItems(home, userData)),
    ...(await projectItems(registered, false, home)),
    ...(await projectItems(nearby, true, home)),
    ...(await appCacheItems(home))
  ]

  const measured = await mapLimit(pending, SIZE_CONCURRENCY, async (entry): Promise<ScannedItem | null> => {
    const bytes = entry.bytes ?? (entry.measure
      ? (await Promise.all(entry.measure.map(sizeOf))).reduce((sum, size) => sum + size, 0)
      : await sizeOf(entry.path))
    const floor = entry.group === 'apps' ? MIN_APP_CACHE_BYTES : MIN_ITEM_BYTES
    if (bytes < floor) return null
    const lastUsedAt = entry.lastUsedAt !== undefined ? entry.lastUsedAt : await mtime(entry.path)
    return {
      item: {
        id: entry.id,
        group: entry.group,
        label: entry.label,
        detail: entry.detail,
        path: entry.path,
        bytes,
        lastUsedAt,
        safety: entry.safety,
        ...(entry.project ? { project: entry.project } : {})
      },
      plan: entry.plan
    }
  })

  const items = measured.filter((entry): entry is ScannedItem => Boolean(entry))
  lastScan = new Map(items.map((entry) => [entry.item.id, entry]))
  const [disk, swap] = await Promise.all([diskSpace(home), swapUsedBytes()])
  return {
    collectedAt: Date.now(),
    durationMs: Date.now() - started,
    items: items.map((entry) => entry.item).sort((a, b) => b.bytes - a.bytes),
    disk,
    swapUsedBytes: swap
  }
}

/** One scan at a time; a second request joins the running one. */
export function scanStorage(): Promise<StorageReport> {
  running ??= runScan()
    .then((report) => {
      lastReport = report
      return report
    })
    .finally(() => {
      running = null
    })
  return running
}
