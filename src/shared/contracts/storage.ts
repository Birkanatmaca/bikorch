/**
 * Storage care: one scan lists the folders that grow on a developer machine
 * (Bikorch's own caches, tool caches, project build outputs), and the user picks
 * what to clean. The renderer only ever sends item ids; the main process maps
 * them back to the paths it found itself.
 */

export const STORAGE_GROUPS = ['bikorch', 'developer', 'projects', 'apps'] as const

export type StorageGroup = (typeof STORAGE_GROUPS)[number]

export const STORAGE_GROUP_COPY: Record<StorageGroup, { label: string; description: string }> = {
  bikorch: { label: 'Bikorch', description: 'Web caches, finished agent worktrees and leftover account folders.' },
  developer: { label: 'Developer tools', description: 'Package, build and SDK caches that tools download again when needed.' },
  projects: { label: 'Projects', description: 'Dependencies and build outputs in your workspaces. Nothing tracked by Git is listed.' },
  apps: { label: 'Other app caches', description: 'Large folders in ~/Library/Caches. Quit the app before cleaning its cache.' }
}

/**
 * - safe: a pure cache; the next run is just a little slower.
 * - rebuild: the tool downloads or builds it again (network, minutes).
 * - caution: something may be lost or an app may need a restart; read the note.
 */
export type StorageSafety = 'safe' | 'rebuild' | 'caution'

export const STORAGE_SAFETY_COPY: Record<StorageSafety, string> = {
  safe: 'Safe',
  rebuild: 'Rebuilds',
  caution: 'Check first'
}

export interface StorageItem {
  id: string
  group: StorageGroup
  label: string
  /** What the folder is and what happens after cleaning it. */
  detail: string
  path: string
  bytes: number
  /** Newest modification time we saw, used to spot projects you no longer touch. */
  lastUsedAt: number | null
  safety: StorageSafety
  /** Project name for project items. */
  project?: string
}

export interface StorageReport {
  collectedAt: number
  durationMs: number
  items: StorageItem[]
  disk: { freeBytes: number; totalBytes: number } | null
  /** macOS swap in use; large values mean memory pressure, not files. */
  swapUsedBytes: number | null
}

export interface StorageCleanResult {
  id: string
  label: string
  ok: boolean
  freedBytes: number
  error?: string
}

export const STORAGE_IPC = {
  SCAN: 'storage:scan',
  CLEAN: 'storage:clean',
  REVEAL: 'storage:reveal'
} as const

/** Days without changes after which a project's dependencies count as stale. */
export const STALE_PROJECT_DAYS = 30
