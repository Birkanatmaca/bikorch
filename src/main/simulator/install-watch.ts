import { existsSync, readdirSync, statSync, watch, type FSWatcher } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { isSimulatorUdid } from './devices'

// Notices when an app is installed on an iOS simulator, typically an agent's
// `simctl install` or `xcodebuild`, so Bikorch can open its device panel on it.
// It watches each device's app-bundle folder with file system events, so an
// idle Mac pays nothing: no processes are started and nothing is polled.

const DEVICES_ROOT = join(homedir(), 'Library', 'Developer', 'CoreSimulator', 'Devices')
/** New devices, and devices booted for the first time, are picked up this often. */
const RESCAN_MS = 30_000
/** An install writes several entries; wait for it to finish. */
const SETTLE_MS = 1_500

/** Bundle folder name → last modified time. */
export type BundleSnapshot = Map<string, number>

/** True when a bundle folder is new or was rewritten (a reinstall) since `before`. */
export function hasNewInstall(before: BundleSnapshot, after: BundleSnapshot): boolean {
  for (const [name, modified] of after) {
    const previous = before.get(name)
    if (previous === undefined || modified > previous) return true
  }
  return false
}

function bundleFolder(udid: string): string {
  return join(DEVICES_ROOT, udid, 'data', 'Containers', 'Bundle', 'Application')
}

function snapshot(folder: string): BundleSnapshot {
  const result: BundleSnapshot = new Map()
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return result
  }
  for (const name of names) {
    if (name.startsWith('.')) continue
    try {
      result.set(name, statSync(join(folder, name)).mtimeMs)
    } catch {
      // Removed while reading.
    }
  }
  return result
}

interface WatchedDevice {
  watcher: FSWatcher
  known: BundleSnapshot
  timer: ReturnType<typeof setTimeout> | null
}

export function watchSimulatorInstalls(onInstall: (udid: string) => void): () => void {
  if (process.platform !== 'darwin') return () => undefined
  const devices = new Map<string, WatchedDevice>()

  const forget = (udid: string): void => {
    const entry = devices.get(udid)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.watcher.close()
    devices.delete(udid)
  }

  const check = (udid: string): void => {
    const entry = devices.get(udid)
    if (!entry) return
    entry.timer = null
    const next = snapshot(bundleFolder(udid))
    const installed = hasNewInstall(entry.known, next)
    entry.known = next
    if (installed) onInstall(udid)
  }

  const scan = (initial: boolean): void => {
    let udids: string[]
    try {
      udids = readdirSync(DEVICES_ROOT).filter(isSimulatorUdid)
    } catch {
      return
    }
    for (const udid of devices.keys()) {
      if (!udids.includes(udid) || !existsSync(bundleFolder(udid))) forget(udid)
    }
    for (const udid of udids) {
      if (devices.has(udid)) continue
      const folder = bundleFolder(udid)
      if (!existsSync(folder)) continue
      const known = snapshot(folder)
      // The folder appears with a device's first install: report that install too.
      const createdNow = !initial && [...known.values()].some((modified) => Date.now() - modified < RESCAN_MS + SETTLE_MS)
      try {
        const entry: WatchedDevice = {
          known,
          timer: null,
          watcher: watch(folder, () => {
            if (entry.timer) clearTimeout(entry.timer)
            entry.timer = setTimeout(() => check(udid), SETTLE_MS)
          })
        }
        entry.watcher.on('error', () => forget(udid))
        devices.set(udid, entry)
        if (createdNow) onInstall(udid)
      } catch {
        // The folder vanished or cannot be watched; the next scan tries again.
      }
    }
  }

  scan(true)
  const interval = setInterval(() => scan(false), RESCAN_MS)
  interval.unref?.()
  return () => {
    clearInterval(interval)
    for (const udid of [...devices.keys()]) forget(udid)
  }
}
