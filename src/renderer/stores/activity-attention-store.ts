import { create } from 'zustand'
import { processNoticeBody, type ProcessFinishOutcome } from '@renderer/lib/project-activity'

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
  notices: ProcessNotice[]
  noteFinish: (input: {
    projectId: string
    panelId: string
    projectName: string
    title: string
    outcome: ProcessFinishOutcome
  }) => void
  clearProject: (projectId: string) => void
  dismissNotice: (id: string) => void
}

const MAX_NOTICES = 4

function desktopNotify(notice: ProcessNotice): void {
  if (typeof Notification === 'undefined') return
  const focused =
    typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()
  if (focused) return
  try {
    new Notification(processNoticeBody(notice.outcome, notice.title, notice.projectName), {
      silent: false
    })
  } catch {
    // Renderer notification support is optional.
  }
}

export const useActivityAttentionStore = create<ActivityAttentionStore>((set) => ({
  attentionByProject: {},
  notices: [],

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
      const attention = [
        ...existing.filter((item) => item.panelId !== input.panelId),
        notice
      ]
      const notices = [
        ...state.notices.filter((item) => item.panelId !== input.panelId),
        notice
      ].slice(-MAX_NOTICES)
      return {
        attentionByProject: {
          ...state.attentionByProject,
          [input.projectId]: attention
        },
        notices
      }
    })
    desktopNotify(notice)
  },

  clearProject: (projectId) => {
    set((state) => {
      if (!state.attentionByProject[projectId] && !state.notices.some((item) => item.projectId === projectId)) {
        return state
      }
      const { [projectId]: _removed, ...attentionByProject } = state.attentionByProject
      return {
        attentionByProject,
        notices: state.notices.filter((item) => item.projectId !== projectId)
      }
    })
  },

  dismissNotice: (id) => {
    set((state) => ({
      notices: state.notices.filter((item) => item.id !== id)
    }))
  }
}))
