import { create } from 'zustand'
import type { ProcessFinishOutcome } from '@renderer/lib/project-activity'
import { noteCliFinished } from '@renderer/lib/notification-feed'
import { isWindowInactive } from '@renderer/lib/window-activity'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

/**
 * "Finished while you were not looking." A notice belongs to one panel and
 * stays until the user actually looks at that panel, not merely opens its
 * project, so every finished session can still be found inside a project.
 */

export interface ProcessNotice {
  id: string
  projectId: string
  panelId: string
  projectName: string
  title: string
  outcome: ProcessFinishOutcome
  at: number
}

interface ActivityAttentionStore {
  attentionByProject: Record<string, ProcessNotice[]>
  /** The panel last focused in each project's workspace. */
  focusedByProject: Record<string, string>
  noteFinish: (input: {
    projectId: string
    panelId: string
    projectName: string
    title: string
    outcome: ProcessFinishOutcome
  }, options?: { notify?: boolean }) => string | null
  /** The user focused a panel: it is seen, and its notice goes away. */
  noteFocus: (projectId: string, panelId: string) => void
  clearPanel: (panelId: string) => void
  /** Drops notices that have no panel to look at (Manager runs). */
  clearDetached: (projectId: string) => void
  clearProject: (projectId: string) => void
}

/** True when the user can see this panel right now. */
export function isPanelInView(projectId: string, panelId: string): boolean {
  const workspace = useWorkspaceStore.getState()
  return (
    !workspace.homeVisible &&
    workspace.activeProjectId === projectId &&
    useActivityAttentionStore.getState().focusedByProject[projectId] === panelId &&
    !isWindowInactive()
  )
}

function withoutPanel(attentionByProject: Record<string, ProcessNotice[]>, panelId: string): Record<string, ProcessNotice[]> | null {
  let changed = false
  const next: Record<string, ProcessNotice[]> = {}
  for (const [projectId, notices] of Object.entries(attentionByProject)) {
    const kept = notices.filter((notice) => notice.panelId !== panelId)
    if (kept.length !== notices.length) changed = true
    if (kept.length > 0) next[projectId] = kept
  }
  return changed ? next : null
}

export const useActivityAttentionStore = create<ActivityAttentionStore>((set, get) => ({
  attentionByProject: {},
  focusedByProject: {},

  noteFinish: (input, options = {}) => {
    // Work that finished in front of the user needs no reminder.
    if (isPanelInView(input.projectId, input.panelId)) return null
    const at = Date.now()
    const notice: ProcessNotice = { id: `${input.panelId}:${at}`, ...input, at }
    set((state) => {
      const existing = state.attentionByProject[input.projectId] ?? []
      return {
        attentionByProject: {
          ...state.attentionByProject,
          [input.projectId]: [...existing.filter((item) => item.panelId !== input.panelId), notice]
        }
      }
    })
    if (options.notify === false) return null
    return noteCliFinished({
      projectId: notice.projectId,
      projectName: notice.projectName,
      panelId: notice.panelId,
      title: notice.title,
      outcome: notice.outcome
    }).id
  },

  noteFocus: (projectId, panelId) => {
    if (get().focusedByProject[projectId] !== panelId) {
      set((state) => ({ focusedByProject: { ...state.focusedByProject, [projectId]: panelId } }))
    }
    get().clearPanel(panelId)
  },

  clearPanel: (panelId) => {
    const next = withoutPanel(get().attentionByProject, panelId)
    if (next) set({ attentionByProject: next })
  },

  clearDetached: (projectId) => {
    const panels = new Set((useWorkspaceStore.getState().workspaces[projectId]?.panels ?? []).map((panel) => panel.id))
    const notices = get().attentionByProject[projectId]
    if (!notices) return
    const kept = notices.filter((notice) => panels.has(notice.panelId))
    if (kept.length === notices.length) return
    set((state) => {
      const { [projectId]: _old, ...rest } = state.attentionByProject
      return { attentionByProject: kept.length > 0 ? { ...rest, [projectId]: kept } : rest }
    })
  },

  clearProject: (projectId) => {
    set((state) => {
      if (!state.attentionByProject[projectId] && !state.focusedByProject[projectId]) return state
      const { [projectId]: _removed, ...attentionByProject } = state.attentionByProject
      const { [projectId]: _focus, ...focusedByProject } = state.focusedByProject
      return { attentionByProject, focusedByProject }
    })
  }
}))
