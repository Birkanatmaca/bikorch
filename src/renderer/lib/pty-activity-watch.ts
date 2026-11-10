import type { PtyEvent, PtyKind } from '@shared/contracts/pty'
import type { CliTaskNotification } from '@shared/contracts/notifications'
import type { SecretaryEvent } from '@shared/contracts/secretary'
import { CliActivityTracker, mapProcessStatus } from '@renderer/lib/cli-activity'
import { focusWorkspacePanel } from '@renderer/lib/app-events'
import { findPanelProject, isWatchedCliPanel } from '@renderer/lib/project-activity'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { isPanelInView, useActivityAttentionStore } from '@renderer/stores/activity-attention-store'
import { noteCliAsking } from '@renderer/lib/notification-feed'
import { onWindowActivity } from '@renderer/lib/window-activity'

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
    getStatus: () => useTerminalStore.getState().getStatus(sessionId),
    screen: true
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

function openFinishedCliTask(payload: CliTaskNotification): void {
  useWorkspaceStore.getState().setActiveProject(payload.projectId)
  if (payload.panelId.startsWith('secretary:')) {
    useActivityAttentionStore.getState().clearPanel(payload.panelId)
    return
  }
  // Focusing the panel marks it seen.
  window.setTimeout(() => focusWorkspacePanel(payload.panelId), 40)
}

/** The project in front of the user: its focused panel counts as seen. */
function markVisiblePanelSeen(): void {
  const workspace = useWorkspaceStore.getState()
  const projectId = workspace.activeProjectId
  if (!projectId || workspace.homeVisible) return
  const attention = useActivityAttentionStore.getState()
  attention.clearDetached(projectId)
  const focused = attention.focusedByProject[projectId]
  if (focused && isPanelInView(projectId, focused)) attention.clearPanel(focused)
}

function noteAsking(sessionId: string): void {
  const owner = findPanelProject(sessionId, useWorkspaceStore.getState().workspaces)
  if (!owner || owner.panel.panelRole === 'secretary') return
  if (isPanelInView(owner.projectId, sessionId)) return
  const project = useWorkspaceStore.getState().projects.find((item) => item.id === owner.projectId)
  noteCliAsking({
    projectId: owner.projectId,
    projectName: project?.name ?? 'Project',
    panelId: sessionId,
    title: owner.panel.title
  })
}

function handleSecretaryEvent(event: SecretaryEvent): void {
  const activeProjectId = useWorkspaceStore.getState().activeProjectId
  if (activeProjectId === event.projectId) return
  if (event.type !== 'run-report' && event.type !== 'run-failed' && event.type !== 'run-needs-user') return
  const project = useWorkspaceStore.getState().projects.find((item) => item.id === event.projectId)
  if (!project) return
  useActivityAttentionStore.getState().noteFinish({
    projectId: event.projectId,
    panelId: `secretary:${event.runId}`,
    projectName: project.name,
    title: 'Manager',
    outcome: event.type === 'run-report' ? 'done' : 'error'
  }, { notify: false }) // The notification feed already announces Manager outcomes.
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
    // A reattaching view gets the whole current screen again. Read it on a
    // clean slate; layered over the old screen it would misread the state.
    if (event.replay) dropTracker(event.sessionId)
    const tracker = trackerFor(event.sessionId)
    tracker.feedText(event.data)
    // Asking is settled before the status, so a prompt never reads as "finished".
    const asking = tracker.isAsking()
    const wasAsking = Boolean(useTerminalStore.getState().asking[event.sessionId])
    useTerminalStore.getState().setAsking(event.sessionId, asking)
    if (asking && !wasAsking) noteAsking(event.sessionId)
    // A screen-backed tracker classifies once its screen has taken the chunk in.
    if (!tracker.readsScreen) tracker.classify()
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
  const unsubscribeClicks = window.api?.notifications?.onClicked(openFinishedCliTask) ?? null
  const unsubscribeSecretary = window.api?.secretary?.onEvent(handleSecretaryEvent) ?? null
  const stopWindowWatch = onWindowActivity((inactive) => {
    if (!inactive) markVisiblePanelSeen()
  })
  unsubscribeWorkspace = useWorkspaceStore.subscribe((state, prev) => {
    if (state.activeProjectId !== prev.activeProjectId || state.homeVisible !== prev.homeVisible) {
      markVisiblePanelSeen()
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
    unsubscribeClicks?.()
    unsubscribeSecretary?.()
    unsubscribeWorkspace?.()
    unsubscribeWorkspace = null
    stopWindowWatch()
    for (const sessionId of trackers.keys()) dropTracker(sessionId)
  }
}
