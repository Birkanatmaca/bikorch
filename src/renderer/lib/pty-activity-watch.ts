import type { PtyEvent, PtyKind } from '@shared/contracts/pty'
import { CliActivityTracker, mapProcessStatus } from '@renderer/lib/cli-activity'
import { findPanelProject, isWatchedCliPanel } from '@renderer/lib/project-activity'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useActivityAttentionStore } from '@renderer/stores/activity-attention-store'

const trackers = new Map<string, CliActivityTracker>()
let started = false
let unsubscribePty: (() => void) | null = null
let unsubscribeWorkspace: (() => void) | null = null

function panelKind(sessionId: string): PtyKind | null {
  const owner = findPanelProject(sessionId, useWorkspaceStore.getState().workspaces)
  if (!owner || !isWatchedCliPanel(owner.panel)) return null
  return owner.panel.type as PtyKind
}

function trackerFor(sessionId: string): CliActivityTracker {
  const existing = trackers.get(sessionId)
  if (existing) return existing
  const tracker = new CliActivityTracker({
    apply: (next) => {
      const current = useTerminalStore.getState().getStatus(sessionId)
      if (current === next) return
      useTerminalStore.getState().setStatus(sessionId, next)
    },
    getStatus: () => useTerminalStore.getState().getStatus(sessionId)
  })
  trackers.set(sessionId, tracker)
  return tracker
}

function dropTracker(sessionId: string): void {
  const tracker = trackers.get(sessionId)
  if (!tracker) return
  tracker.dispose()
  trackers.delete(sessionId)
}

function handlePtyEvent(event: PtyEvent): void {
  if (event.type === 'exit') {
    dropTracker(event.sessionId)
    const current = useTerminalStore.getState().getStatus(event.sessionId)
    if (current && current !== 'stopped') {
      useTerminalStore.getState().setStatus(event.sessionId, 'stopped')
    }
    return
  }

  const kind = panelKind(event.sessionId)
  if (!kind) {
    dropTracker(event.sessionId)
    return
  }

  if (event.type === 'data') {
    trackerFor(event.sessionId).feed(event.data)
    return
  }

  if (event.type === 'status') {
    if (event.status === 'stopped') return
    if (event.status === 'running' || event.status === 'starting') {
      const current = useTerminalStore.getState().getStatus(event.sessionId)
      if (current === 'busy' || current === 'waiting') return
    }
    useTerminalStore.getState().setStatus(
      event.sessionId,
      mapProcessStatus(kind, event.status),
      event.error
    )
  }
}

export function startPtyActivityWatch(): () => void {
  if (started) return () => {}
  started = true

  unsubscribePty = window.api?.pty?.onEvent(handlePtyEvent) ?? null
  unsubscribeWorkspace = useWorkspaceStore.subscribe((state, prev) => {
    if (state.activeProjectId && state.activeProjectId !== prev.activeProjectId) {
      useActivityAttentionStore.getState().clearProject(state.activeProjectId)
    }
    for (const project of prev.projects) {
      if (!state.projects.some((item) => item.id === project.id)) {
        useActivityAttentionStore.getState().clearProject(project.id)
      }
    }
  })

  return () => {
    started = false
    unsubscribePty?.()
    unsubscribePty = null
    unsubscribeWorkspace?.()
    unsubscribeWorkspace = null
    for (const sessionId of trackers.keys()) dropTracker(sessionId)
  }
}
