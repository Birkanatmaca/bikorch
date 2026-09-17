import { create } from 'zustand'
import type { PtySessionStatus } from '@shared/contracts/pty'
import { didProcessFinish, findPanelProject, isWatchedCliPanel } from '@renderer/lib/project-activity'
import { useActivityAttentionStore } from '@renderer/stores/activity-attention-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

interface TerminalStore {
  sessions: Record<string, PtySessionStatus>
  errors: Record<string, string | undefined>
  outputTails: Record<string, string>

  setStatus: (sessionId: string, status: PtySessionStatus, error?: string) => void
  setOutputTail: (sessionId: string, tail: string) => void
  removeSession: (sessionId: string) => void
  getStatus: (sessionId: string) => PtySessionStatus | undefined
  getOutputTail: (sessionId: string) => string
}

function noteCliTaskFinish(sessionId: string, next: PtySessionStatus, prev?: PtySessionStatus): void {
  const outcome = didProcessFinish(prev, next)
  if (!outcome) return
  const workspace = useWorkspaceStore.getState()
  const owner = findPanelProject(sessionId, workspace.workspaces)
  if (!owner || !isWatchedCliPanel(owner.panel)) return
  const project = workspace.projects.find((item) => item.id === owner.projectId)
  useActivityAttentionStore.getState().noteFinish({
    projectId: owner.projectId,
    panelId: sessionId,
    projectName: project?.name ?? 'Project',
    title: owner.panel.title,
    outcome
  })
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: {},
  errors: {},
  outputTails: {},

  setStatus: (sessionId, status, error) => {
    const prev = get().sessions[sessionId]
    if (prev === status && get().errors[sessionId] === error) return
    set((state) => ({
      sessions: { ...state.sessions, [sessionId]: status },
      errors: { ...state.errors, [sessionId]: error }
    }))
    noteCliTaskFinish(sessionId, status, prev)
  },

  setOutputTail: (sessionId, tail) => {
    if (get().outputTails[sessionId] === tail) return
    set((state) => ({
      outputTails: { ...state.outputTails, [sessionId]: tail }
    }))
  },

  removeSession: (sessionId) => {
    set((state) => {
      const { [sessionId]: _s, ...sessions } = state.sessions
      const { [sessionId]: _e, ...errors } = state.errors
      const { [sessionId]: _t, ...outputTails } = state.outputTails
      return { sessions, errors, outputTails }
    })
  },

  getStatus: (sessionId) => get().sessions[sessionId],
  getOutputTail: (sessionId) => get().outputTails[sessionId] ?? ''
}))
