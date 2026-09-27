import { app, session } from 'electron'
import type { Dirent } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join, relative, sep } from 'path'
import type { ResourceDiskSnapshot } from '@shared/contracts/resources'

const WEB_PARTITIONS = ['persist:chatgpt', 'persist:claude-chat', 'persist:workspace-browser'] as const
const MAX_PARTITION_CACHE_BYTES = 256 * 1024 * 1024

function webSessions(): Electron.Session[] {
  return [session.defaultSession, ...WEB_PARTITIONS.map((name) => session.fromPartition(name))]
}

const HTTP_CACHE_PARTS = [
  { id: 'app-http', label: 'App HTTP cache', partition: null },
  { id: 'chatgpt-http', label: 'ChatGPT HTTP cache', partition: 'persist:chatgpt' },
  { id: 'claude-http', label: 'Claude HTTP cache', partition: 'persist:claude-chat' },
  { id: 'browser-http', label: 'Workspace browser HTTP cache', partition: 'persist:workspace-browser' }
] as const

async function browserCacheBytes(): Promise<number> {
  const sizes = await Promise.all(webSessions().map((item) => item.getCacheSize().catch(() => 0)))
  return sizes.reduce((sum, size) => sum + size, 0)
}

export async function measureHttpCacheParts(): Promise<Array<{ id: string; label: string; bytes: number }>> {
  return Promise.all(HTTP_CACHE_PARTS.map(async (part) => ({
    id: part.id,
    label: part.label,
    bytes: await (part.partition ? session.fromPartition(part.partition) : session.defaultSession).getCacheSize().catch(() => 0)
  })))
}

async function directoryBytes(root: string): Promise<number> {
  let bytes = 0
  const pending = [root]
  while (pending.length) {
    const directory = pending.pop()!
    let entries: Dirent[]
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) {
        try {
          bytes += (await stat(path)).size
        } catch {
          // Chromium may replace an individual cache entry during measurement.
        }
      }
    }
  }
  return bytes
}

function codeCacheRoots(): Array<{ id: string; label: string; path: string }> {
  const root = app.getPath('userData')
  return [
    { id: 'app-code', label: 'App code cache', path: join(root, 'Code Cache') },
    ...WEB_PARTITIONS.map((name) => {
      const folder = name.slice('persist:'.length)
      const label = folder === 'chatgpt' ? 'ChatGPT code cache' : folder === 'claude-chat' ? 'Claude code cache' : 'Workspace browser code cache'
      return { id: `${folder}-code`, label, path: join(root, 'Partitions', folder, 'Code Cache') }
    })
  ]
}

async function codeCacheBytes(): Promise<number> {
  const sizes = await Promise.all(codeCacheRoots().map((part) => directoryBytes(part.path)))
  return sizes.reduce((sum, size) => sum + size, 0)
}

export async function measureClearableCacheParts(): Promise<Array<{ id: string; label: string; bytes: number }>> {
  const [http, code] = await Promise.all([
    measureHttpCacheParts(),
    Promise.all(codeCacheRoots().map(async (part) => ({ id: part.id, label: part.label, bytes: await directoryBytes(part.path) })))
  ])
  return [...http, ...code]
}

async function clearableBrowserCacheBytes(): Promise<number> {
  const [http, code] = await Promise.all([browserCacheBytes(), codeCacheBytes()])
  return http + code
}

/** Scan only when the user opens the Runtime panel, never on its 3s process poll. */
export async function collectDiskSnapshot(): Promise<ResourceDiskSnapshot> {
  const root = app.getPath('userData')
  const seen = new Set<string>()
  const totals = { appDataBytes: 0, accountProfilesBytes: 0, browserSessionBytes: 0, musicBytes: 0 }
  const pending = [root]

  while (pending.length) {
    const directory = pending.pop()!
    let entries: Dirent[]
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(path)
        continue
      }
      // Never follow symlinks out of the app's data directory.
      if (!entry.isFile()) continue
      try {
        const info = await stat(path)
        const inode = `${info.dev}:${info.ino}`
        if (seen.has(inode)) continue
        seen.add(inode)
        const top = relative(root, path).split(sep)[0]
        totals.appDataBytes += info.size
        if (top === 'cli-profiles') totals.accountProfilesBytes += info.size
        else if (top === 'Partitions') totals.browserSessionBytes += info.size
        else if (top === 'music') totals.musicBytes += info.size
      } catch {
        // A concurrently removed cache entry is not an error for this snapshot.
      }
    }
  }

  return {
    collectedAt: Date.now(),
    ...totals,
    otherBytes: Math.max(0, totals.appDataBytes - totals.accountProfilesBytes - totals.browserSessionBytes - totals.musicBytes),
    browserCacheBytes: await clearableBrowserCacheBytes()
  }
}

/** HTTP caches only: cookies, local storage, CLI credentials and downloads remain intact. */
export async function clearBrowserCaches(): Promise<number> {
  const before = await clearableBrowserCacheBytes()
  await Promise.all(webSessions().map(async (item) => {
    await item.clearCache()
    await item.clearCodeCaches({})
  }))
  return Math.max(0, before - await clearableBrowserCacheBytes())
}

/** One launch-time budget check; small caches stay warm and avoid needless network/CPU churn. */
export async function pruneOversizedBrowserCaches(): Promise<void> {
  for (const item of webSessions()) {
    const size = await item.getCacheSize().catch(() => 0)
    if (size > MAX_PARTITION_CACHE_BYTES) {
      await item.clearCache()
      await item.clearCodeCaches({})
    }
  }
}
