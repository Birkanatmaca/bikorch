import { create } from 'zustand'
import { AI_ACCOUNT_KINDS, AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import type { CliUsageKind } from '@shared/contracts/usage'
import { isCliInstallationRunning, type CliInstallation } from '@shared/contracts/cli'

interface CliStore {
  installedByKind: Partial<Record<CliUsageKind, boolean>>
  errorsByKind: Partial<Record<CliUsageKind, string>>
  installingKind: CliUsageKind | null
  installation: CliInstallation | null
  syncStatus: () => Promise<void>
  refresh: () => Promise<void>
  detect: (kind: CliUsageKind) => Promise<boolean>
  install: (kind: CliUsageKind) => Promise<boolean>
}

let refreshInFlight: Promise<void> | null = null
let statusInFlight: Promise<void> | null = null
let localInstallKind: CliUsageKind | null = null
const revisions: Partial<Record<CliUsageKind, number>> = {}

function withTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI check timed out. Try again.')), 25_000)
    operation.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

export const useCliStore = create<CliStore>((set, get) => ({
  installedByKind: {},
  errorsByKind: {},
  installingKind: null,
  installation: null,
  syncStatus: async () => {
    if (!statusInFlight) statusInFlight = (async () => {
      const { installation } = await withTimeout(window.api.cli.status())
      if (localInstallKind) {
        if (installation?.kind === localInstallKind) set({ installation })
        return
      }
      const wasInstalling = get().installingKind
      set({ installation, installingKind: isCliInstallationRunning(installation) ? installation!.kind : null })
      if (installation?.error && !get().installedByKind[installation.kind]) set((state) => ({
        errorsByKind: { ...state.errorsByKind, [installation.kind]: installation.error }
      }))
      if (wasInstalling && !isCliInstallationRunning(installation)) await get().detect(wasInstalling)
    })().catch(() => {
      // Keep an ongoing installation visible until the main process can be queried again.
    }).finally(() => { statusInFlight = null })
    await statusInFlight
  },
  detect: async (kind) => {
    const revision = revisions[kind] = (revisions[kind] ?? 0) + 1
    try {
      const result = await withTimeout(window.api.cli.detect(kind))
      if (revision === revisions[kind]) set((state) => ({
        installedByKind: { ...state.installedByKind, [kind]: result.installed },
        errorsByKind: { ...state.errorsByKind, [kind]: result.installed ? undefined : result.error || state.errorsByKind[kind] }
      }))
      return result.installed
    } catch (error) {
      if (revision === revisions[kind]) set((state) => ({
        installedByKind: { ...state.installedByKind, [kind]: undefined },
        errorsByKind: { ...state.errorsByKind, [kind]: error instanceof Error ? error.message : 'Could not check CLI installation' }
      }))
      return false
    }
  },
  refresh: async () => {
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        await get().syncStatus()
        await Promise.all(AI_ACCOUNT_KINDS.filter((kind) => kind !== get().installingKind).map((kind) => get().detect(kind)))
      })().finally(() => { refreshInFlight = null })
    }
    await refreshInFlight
  },
  install: async (kind) => {
    if (get().installingKind) return false
    localInstallKind = kind
    revisions[kind] = (revisions[kind] ?? 0) + 1
    set((state) => ({ installingKind: kind, errorsByKind: { ...state.errorsByKind, [kind]: undefined } }))
    try {
      const result = await window.api.cli.install(kind)
      if (!result.ok) throw new Error(result.error || `${AI_ACCOUNT_LABELS[kind]} installation failed`)
      if (!await get().detect(kind)) throw new Error(`${AI_ACCOUNT_LABELS[kind]} was not found after installation. Try again.`)
      return true
    } catch (error) {
      // A failed repair may leave an earlier working installation intact.
      await get().detect(kind)
      set((state) => ({
        errorsByKind: { ...state.errorsByKind, [kind]: error instanceof Error ? error.message : 'CLI installation failed' }
      }))
      return false
    } finally {
      localInstallKind = null
      set({ installingKind: null })
      await get().syncStatus()
    }
  }
}))
