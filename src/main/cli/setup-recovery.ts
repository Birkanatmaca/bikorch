import { readdir, rm } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { managedCliPaths } from './managed-paths'
import { recoverDirectory } from './atomic-directory'

let pending: Promise<void> | null = null

export function initializeManagedSetup(): Promise<void> {
  if (!pending) pending = (async () => {
    const { root, runtime } = managedCliPaths()
    for (const target of [runtime, managedCliPaths('gemini').prefix, managedCliPaths('codex').prefix]) {
      try { recoverDirectory(target) }
      catch (error) { console.warn('[cli] Could not recover managed tools:', error) }
    }
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^(?:node|gemini|codex)-install-[a-zA-Z0-9]+$/.test(entry.name)) continue
      const path = resolve(join(root, entry.name))
      if (!path.startsWith(resolve(root) + sep)) continue
      await rm(path, { recursive: true, force: true }).catch(() => undefined)
    }
  })()
  return pending
}
