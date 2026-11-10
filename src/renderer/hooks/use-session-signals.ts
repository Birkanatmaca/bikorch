import { useEffect, useMemo, useState } from 'react'
import type { PanelType } from '@shared/types'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useActivityAttentionStore } from '@renderer/stores/activity-attention-store'
import {
  isPtyPanelType,
  sessionSignal,
  summarizeProjectSessions,
  type ProcessFinishOutcome,
  type ProjectSessionSummary,
  type SessionSignal
} from '@renderer/lib/project-activity'

/** The current time, refreshed on an interval while `active`. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs])
  return now
}

/** One panel's signal, as its header and frame show it. */
export function usePanelSignal(panelId: string, type: PanelType): { signal: SessionSignal; since: number | undefined } | null {
  const status = useTerminalStore((state) => state.sessions[panelId])
  const asking = useTerminalStore((state) => Boolean(state.asking[panelId]))
  const since = useTerminalStore((state) => state.busySince[panelId])
  const unseen = useActivityAttentionStore((state): ProcessFinishOutcome | undefined => {
    for (const notices of Object.values(state.attentionByProject)) {
      const notice = notices.find((item) => item.panelId === panelId)
      if (notice) return notice.outcome
    }
    return undefined
  })
  if (!isPtyPanelType(type)) return null
  return { signal: sessionSignal({ status, asking, unseen }), since }
}

/** Every project's session summary, for tabs and Home. */
export function useProjectSessionSummaries(): Record<string, ProjectSessionSummary> {
  const projects = useWorkspaceStore((state) => state.projects)
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const sessions = useTerminalStore((state) => state.sessions)
  const asking = useTerminalStore((state) => state.asking)
  const busySince = useTerminalStore((state) => state.busySince)
  const attentionByProject = useActivityAttentionStore((state) => state.attentionByProject)
  return useMemo(() => Object.fromEntries(projects.map((project) => [
    project.id,
    summarizeProjectSessions({
      panels: workspaces[project.id]?.panels ?? [],
      sessions,
      asking,
      busySince,
      attention: attentionByProject[project.id] ?? []
    })
  ])), [asking, attentionByProject, busySince, projects, sessions, workspaces])
}

export function signalFrameClass(signal: SessionSignal | undefined): string {
  switch (signal) {
    case 'asking': return 'cli-ask-frame'
    case 'done': return 'cli-done-frame'
    case 'error': return 'cli-error-frame'
    default: return ''
  }
}
