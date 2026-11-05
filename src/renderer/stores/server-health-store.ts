import { create } from 'zustand'
import type { ServerHealth } from '@shared/contracts/server-health'
import type { RemoteServer } from '@shared/contracts/servers'
import { isDocumentHidden, onDocumentVisibility } from '@renderer/lib/visibility'
import { useServerStore } from './server-store'

const POLL_MS = 60_000

interface ServerHealthState {
  healthById: Record<string, ServerHealth>
  checkingIds: Record<string, boolean>
  check: (server: RemoteServer) => Promise<void>
  checkAll: () => Promise<void>
}

export const useServerHealthStore = create<ServerHealthState>((set, get) => ({
  healthById: {},
  checkingIds: {},

  check: async (server) => {
    if (get().checkingIds[server.id] || !window.api?.serverHealth) return
    set((state) => ({ checkingIds: { ...state.checkingIds, [server.id]: true } }))
    try {
      const health = await window.api.serverHealth.check(server.id, { user: server.user, host: server.host, port: server.port })
      set((state) => ({ healthById: { ...state.healthById, [server.id]: health } }))
    } catch {
      // A failed check keeps the last known health.
    } finally {
      set((state) => ({ checkingIds: { ...state.checkingIds, [server.id]: false } }))
    }
  },

  checkAll: async () => {
    await Promise.all(useServerStore.getState().servers.map((server) => get().check(server)))
  }
}))

let watchers = 0
let timer: number | null = null
let stopVisibility: (() => void) | null = null

/**
 * Checks every saved server now and each minute while something shows health
 * and the window is visible. Returns the stop function for that watcher.
 */
export function watchServerHealth(): () => void {
  watchers += 1
  if (watchers === 1) {
    const tick = (): void => {
      if (!isDocumentHidden()) void useServerHealthStore.getState().checkAll()
    }
    tick()
    timer = window.setInterval(tick, POLL_MS)
    stopVisibility = onDocumentVisibility((hidden) => {
      if (!hidden) tick()
    })
  }
  return () => {
    watchers = Math.max(0, watchers - 1)
    if (watchers > 0) return
    if (timer !== null) window.clearInterval(timer)
    timer = null
    stopVisibility?.()
    stopVisibility = null
  }
}
