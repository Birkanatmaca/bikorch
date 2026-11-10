import type { PtyKind, PtySessionStatus } from '@shared/contracts/pty'
import { cliTaskNotificationCopy } from '@shared/contracts/notifications'
import { isCliKind } from '@renderer/lib/cli-activity'
import { type PanelDefinition, type PanelType, type ProjectWorkspaceState } from '@shared/types'

export const PTY_PANEL_TYPES: PanelType[] = [
  'terminal',
  'claude',
  'cursor',
  'gemini',
  'antigravity',
  'codex'
]

export type ProcessFinishOutcome = 'done' | 'error'

export interface ProcessAttention {
  panelId: string
  title: string
  outcome: ProcessFinishOutcome
  at: number
}

export function isPtyPanelType(type: PanelType): boolean {
  return PTY_PANEL_TYPES.includes(type)
}

export function findPanelProject(
  sessionId: string,
  workspaces: Record<string, ProjectWorkspaceState>
): { projectId: string; panel: PanelDefinition } | null {
  for (const [projectId, workspace] of Object.entries(workspaces)) {
    const panel = workspace.panels.find((item) => item.id === sessionId)
    if (panel) return { projectId, panel }
  }
  return null
}

export function didProcessFinish(
  prev: PtySessionStatus | undefined,
  next: PtySessionStatus
): ProcessFinishOutcome | null {
  if (prev !== 'busy') return null
  if (next === 'waiting' || next === 'stopped') return 'done'
  if (next === 'error') return 'error'
  return null
}

/**
 * One status per session, shared by tabs, panel headers, Home and notices.
 * Order is priority: what most needs the user comes first.
 */
export type SessionSignal = 'asking' | 'error' | 'working' | 'done' | 'idle' | 'off'

export const SESSION_SIGNAL_ORDER: SessionSignal[] = ['asking', 'error', 'working', 'done', 'idle', 'off']

export const SESSION_SIGNAL_LABEL: Record<SessionSignal, string> = {
  asking: 'Needs you',
  error: 'Error',
  working: 'Working',
  done: 'Done',
  idle: 'Idle',
  off: 'Stopped'
}

export function sessionSignal(input: {
  status: PtySessionStatus | undefined
  asking?: boolean
  /** Finished while the user was not looking, and not yet seen. */
  unseen?: ProcessFinishOutcome
}): SessionSignal {
  const { status, asking, unseen } = input
  if (asking && status !== 'stopped' && status !== 'error') return 'asking'
  if (status === 'error' || unseen === 'error') return 'error'
  if (status === 'busy' || status === 'starting') return 'working'
  if (unseen === 'done') return 'done'
  if (status === 'stopped') return 'off'
  return 'idle'
}

export interface ProjectSessionRow {
  panelId: string
  title: string
  signal: SessionSignal
  /** When the current run started, for "working 2m". */
  since?: number
}

export interface ProjectSessionSummary {
  /** The most urgent signal across the project, or null when nothing is going on. */
  top: Exclude<SessionSignal, 'idle' | 'off'> | null
  counts: Record<SessionSignal, number>
  rows: ProjectSessionRow[]
}

export function summarizeProjectSessions(input: {
  panels: PanelDefinition[]
  sessions: Record<string, PtySessionStatus>
  asking?: Record<string, boolean>
  busySince?: Record<string, number>
  attention: ProcessAttention[]
}): ProjectSessionSummary {
  const unseen = new Map(input.attention.map((item) => [item.panelId, item.outcome]))
  const counts: Record<SessionSignal, number> = { asking: 0, error: 0, working: 0, done: 0, idle: 0, off: 0 }
  const rows: ProjectSessionRow[] = []
  for (const panel of input.panels) {
    if (!isPtyPanelType(panel.type)) continue
    const signal = sessionSignal({
      status: input.sessions[panel.id],
      asking: input.asking?.[panel.id],
      unseen: unseen.get(panel.id)
    })
    counts[signal] += 1
    rows.push({ panelId: panel.id, title: panel.title, signal, ...(signal === 'working' && input.busySince?.[panel.id] ? { since: input.busySince[panel.id] } : {}) })
    unseen.delete(panel.id)
  }
  // Manager runs and other notices without a panel still count.
  for (const item of input.attention) {
    if (!unseen.has(item.panelId)) continue
    const signal: SessionSignal = item.outcome === 'error' ? 'error' : 'done'
    counts[signal] += 1
    rows.push({ panelId: item.panelId, title: item.title, signal })
  }
  rows.sort((a, b) => SESSION_SIGNAL_ORDER.indexOf(a.signal) - SESSION_SIGNAL_ORDER.indexOf(b.signal))
  const top = (['asking', 'error', 'working', 'done'] as const).find((signal) => counts[signal] > 0) ?? null
  return { top, counts, rows }
}

export function formatElapsed(since: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function processNoticeBody(outcome: ProcessFinishOutcome, title: string, projectName: string): string {
  return cliTaskNotificationCopy({ title, projectName, outcome }).body
}

export function isWatchedCliPanel(panel: PanelDefinition): boolean {
  return isPtyPanelType(panel.type) && isCliKind(panel.type as PtyKind)
}
