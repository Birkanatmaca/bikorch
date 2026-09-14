import { create } from 'zustand'
import type { ProcessFinishOutcome } from '@renderer/lib/project-activity'

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
  }) => void
  clearProject: (projectId: string) => void
}

function desktopNotify(notice: ProcessNotice): void {
  const api = window.api?.notifications
  if (!api?.showCliTask) return
  void api
    .showCliTask({
      projectId: notice.projectId,
      panelId: notice.panelId,
      projectName: notice.projectName,
      title: notice.title,
      outcome: notice.outcome
    })
    .catch(() => undefined)
}

export const useActivityAttentionStore = create<ActivityAttentionStore>((set) => ({
  attentionByProject: {},

  noteFinish: (input) => {
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
    desktopNotify(notice)
  },

  clearProject: (projectId) => {
    set((state) => {
      if (!state.attentionByProject[projectId]) return state
      const { [projectId]: _removed, ...attentionByProject } = state.attentionByProject
      return { attentionByProject }
    })
  }
}))
