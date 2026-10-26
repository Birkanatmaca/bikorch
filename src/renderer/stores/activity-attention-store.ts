import { create } from 'zustand'
import type { ProcessFinishOutcome } from '@renderer/lib/project-activity'
import { noteCliFinished } from '@renderer/lib/notification-feed'

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
  noteFinish: (input: {
    projectId: string
    panelId: string
    projectName: string
    title: string
    outcome: ProcessFinishOutcome
  }, options?: { notify?: boolean }) => void
  clearProject: (projectId: string) => void
}

export const useActivityAttentionStore = create<ActivityAttentionStore>((set) => ({
  attentionByProject: {},

  noteFinish: (input, options = {}) => {
    const at = Date.now()
    const notice: ProcessNotice = {
      id: `${input.panelId}:${at}`,
      projectId: input.projectId,
      panelId: input.panelId,
      projectName: input.projectName,
      title: input.title,
      outcome: input.outcome,
      at
    }
    set((state) => {
      const existing = state.attentionByProject[input.projectId] ?? []
      return {
        attentionByProject: {
          ...state.attentionByProject,
          [input.projectId]: [...existing.filter((item) => item.panelId !== input.panelId), notice]
        }
      }
    })
    if (options.notify !== false) {
      noteCliFinished({
        projectId: notice.projectId,
        projectName: notice.projectName,
        panelId: notice.panelId,
        title: notice.title,
        outcome: notice.outcome
      })
    }
  },

  clearProject: (projectId) => {
    set((state) => {
      if (!state.attentionByProject[projectId]) return state
      const { [projectId]: _removed, ...attentionByProject } = state.attentionByProject
      return { attentionByProject }
    })
  }
}))
