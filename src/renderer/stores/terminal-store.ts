import { create } from 'zustand'
import type { PtySessionStatus } from '@shared/contracts/pty'
import { didProcessFinish, findPanelProject } from '@renderer/lib/project-activity'
import { useActivityAttentionStore } from '@renderer/stores/activity-attention-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

interface TerminalStore {
  sessions: Record<string, PtySessionStatus>
  errors: Record<string, string | undefined>

  setStatus: (sessionId: string, status: PtySessionStatus, error?: string) => void
  removeSession: (sessionId: string) => void
  getStatus: (sessionId: string) => PtySessionStatus | undefined
}

function noteBackgroundFinish(sessionId: string, next: PtySessionStatus, prev?: PtySessionStatus): void {
  const outcome = didProcessFinish(prev, next)
  if (!outcome) return
  const workspace = useWorkspaceStore.getState()
  const owner = findPanelProject(sessionId, workspace.workspaces)
  if (!owner || owner.projectId === workspace.activeProjectId) return
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

  setStatus: (sessionId, status, error) => {
    const prev = get().sessions[sessionId]
    if (prev === status && get().errors[sessionId] === error) return
    set((state) => ({
      sessions: { ...state.sessions, [sessionId]: status },
      errors: { ...state.errors, [sessionId]: error }
    }))
    noteBackgroundFinish(sessionId, status, prev)
  },

  removeSession: (sessionId) => {
    set((state) => {
      const { [sessionId]: _s, ...sessions } = state.sessions
      const { [sessionId]: _e, ...errors } = state.errors
      return { sessions, errors }
    })
  },

  getStatus: (sessionId) => get().sessions[sessionId]
}))
