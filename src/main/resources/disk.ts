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

async function browserCacheBytes(): Promise<number> {
  const sizes = await Promise.all(webSessions().map((item) => item.getCacheSize().catch(() => 0)))
  return sizes.reduce((sum, size) => sum + size, 0)
}

async function codeCacheBytes(): Promise<number> {
  const root = app.getPath('userData')
  const roots = [join(root, 'Code Cache'),
    ...WEB_PARTITIONS.map((name) => join(root, 'Partitions', name.slice('persist:'.length), 'Code Cache'))]
  let bytes = 0
  const pending = [...roots]
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
