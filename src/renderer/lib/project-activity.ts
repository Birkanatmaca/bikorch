import type { PtyKind, PtySessionStatus } from '@shared/contracts/pty'
import { isCliKind } from '@renderer/lib/cli-activity'
import { PANEL_TYPE_LABELS, type PanelDefinition, type PanelType, type ProjectWorkspaceState } from '@shared/types'

export const PTY_PANEL_TYPES: PanelType[] = [
  'terminal',
  'claude',
  'cursor',
  'gemini',
  'antigravity',
  'codex'
]

export type ProjectTabSignal = 'idle' | 'busy' | 'ready' | 'error'
export type ProcessFinishOutcome = 'done' | 'error'

export interface ProcessAttention {
  panelId: string
  title: string
  outcome: ProcessFinishOutcome
  at: number
}

export interface ProjectTabActivity {
  signal: ProjectTabSignal
  busyCount: number
  label: string
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

export function summarizeProjectTabActivity(input: {
  panels: PanelDefinition[]
  sessions: Record<string, PtySessionStatus>
  attention: ProcessAttention[]
}): ProjectTabActivity {
  let busyCount = 0
  let workingTitle: string | null = null

  for (const panel of input.panels) {
    if (!isPtyPanelType(panel.type)) continue
    const status = input.sessions[panel.id]
    if (status === 'busy' || status === 'starting') {
      busyCount += 1
      workingTitle ??= panel.title || PANEL_TYPE_LABELS[panel.type]
    }
  }

  if (busyCount > 0) {
    return {
      signal: 'busy',
      busyCount,
      label: busyCount === 1 ? `${workingTitle ?? 'Agent'} working` : `${busyCount} agents working`
    }
  }

  const latest = latestAttention(input.attention)
  if (!latest) {
    return { signal: 'idle', busyCount: 0, label: '' }
  }

  if (latest.outcome === 'error') {
    return {
      signal: 'error',
      busyCount: 0,
      label: `${latest.title} failed — open to review`
    }
  }

  return {
    signal: 'ready',
    busyCount: 0,
    label: `${latest.title} finished — open to review`
  }
}

export function processNoticeBody(outcome: ProcessFinishOutcome, title: string, projectName: string): string {
  const verb = outcome === 'error' ? 'failed' : 'finished'
  return `${title} ${verb} in ${projectName}`
}

function latestAttention(attention: ProcessAttention[]): ProcessAttention | null {
  let latest: ProcessAttention | null = null
  for (const item of attention) {
    if (!latest || item.at >= latest.at) latest = item
  }
  return latest
}

export function isWatchedCliPanel(panel: PanelDefinition): boolean {
  return isPtyPanelType(panel.type) && isCliKind(panel.type as PtyKind)
}
