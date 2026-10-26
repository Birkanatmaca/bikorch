import type { SecretaryEvent } from '@shared/contracts/secretary'
import { useNotificationStore, type AppNotice } from '@renderer/stores/notification-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { isWindowInactive } from './window-activity'

let started = false

function projectName(projectId: string): string {
  return useWorkspaceStore.getState().projects.find((project) => project.id === projectId)?.name ?? 'Project'
}

function clip(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean
}

/** The OS banner, only while the user is looking at another app. */
function desktopNotice(notice: AppNotice): void {
  if (!isWindowInactive()) return
  const api = window.api?.notifications
  if (!api?.showCliTask) return
  const summary = [notice.headline, ...notice.highlights.slice(0, 2).map((item) => `• ${item}`)].join('\n')
  void api
    .showCliTask({
      projectId: notice.projectId,
      panelId: notice.runId ? `secretary:${notice.runId}` : notice.panelIds[0] ?? `notice:${notice.id}`,
      projectName: notice.projectName,
      title: notice.source,
      outcome: notice.kind === 'failed' ? 'error' : 'done',
      heading: `${notice.source} · ${notice.projectName}`,
      summary
    })
    .catch(() => undefined)
}

export function noticeFromSecretaryEvent(event: SecretaryEvent, name: string): Omit<AppNotice, 'id' | 'at' | 'read'> | null {
  const base = { projectId: event.projectId, projectName: name, source: 'Manager' }
  if (event.type === 'run-report') {
    const goalKind = event.goal
      ? event.goal.status === 'met' ? 'done' as const : event.goal.status === 'blocked' ? 'needs-input' as const : 'failed' as const
      : null
    return {
      ...base,
      kind: goalKind ?? (event.status === 'failed' ? 'failed' : 'done'),
      headline: event.notice?.headline || (event.status === 'failed' ? 'The work did not finish.' : 'The work is done.'),
      highlights: event.notice?.highlights ?? [],
      changedFiles: event.changedFiles.length,
      panelIds: event.panelIds,
      runId: event.runId
    }
  }
  if (event.type === 'run-followup') {
    if (event.autoStart) {
      return {
        ...base,
        kind: 'done',
        headline: event.notice?.headline ?? 'Starting the next goal round.',
        highlights: event.notice?.highlights ?? [],
        changedFiles: event.completedEvidence.changedFiles?.length ?? 0,
        panelIds: [],
        runId: event.runId
      }
    }
    return {
      ...base,
      kind: 'plan-ready',
      headline: 'A follow-up plan is ready for your approval.',
      highlights: event.plan.overview ? [clip(event.plan.overview, 160)] : [],
      changedFiles: event.completedEvidence.changedFiles?.length ?? 0,
      panelIds: [],
      runId: event.runId
    }
  }
  if (event.type === 'run-needs-user') {
    return {
      ...base,
      kind: 'needs-input',
      headline: `${clip(event.assignmentTitle, 70)} needs your answer.`,
      highlights: [clip(event.message, 160)],
      changedFiles: 0,
      panelIds: [],
      runId: event.runId
    }
  }
  if (event.type === 'run-failed') {
    return {
      ...base,
      kind: 'failed',
      headline: 'The Manager stopped this work.',
      highlights: [clip(event.message, 160)],
      changedFiles: 0,
      panelIds: [],
      runId: event.runId
    }
  }
  return null
}

/** One listener for the whole app: Manager outcomes become toasts, history and OS banners. */
export function startNotificationFeed(): () => void {
  if (started || !window.api?.secretary?.onEvent) return () => undefined
  started = true
  const stop = window.api.secretary.onEvent((event) => {
    const input = noticeFromSecretaryEvent(event, projectName(event.projectId))
    if (!input) return
    // Intermediate goal rounds are progress, not news: keep them in the history only.
    const progress = event.type === 'run-followup' && event.autoStart === true
    const notice = useNotificationStore.getState().push(input, { toast: !progress })
    if (!progress) desktopNotice(notice)
  })
  return () => {
    started = false
    stop()
  }
}

/** A plain CLI panel went idle. Quiet unless the user cannot see that panel. */
export function noteCliFinished(input: {
  projectId: string
  projectName: string
  panelId: string
  title: string
  outcome: 'done' | 'error'
}): void {
  const visible = useWorkspaceStore.getState().activeProjectId === input.projectId && !isWindowInactive()
  const notice = useNotificationStore.getState().push({
    kind: input.outcome === 'error' ? 'failed' : 'done',
    projectId: input.projectId,
    projectName: input.projectName,
    source: input.title,
    headline: input.outcome === 'error' ? `${input.title} stopped with an error.` : `${input.title} finished and is waiting for you.`,
    highlights: [],
    changedFiles: 0,
    panelIds: [input.panelId]
  }, { toast: !visible })
  if (visible) useNotificationStore.getState().markRead(notice.id)
  desktopNotice(notice)
}
