import { create } from 'zustand'
import type { PtySessionStatus } from '@shared/contracts/pty'
import { findPanelProject, isWatchedCliPanel, type ProcessFinishOutcome } from '@renderer/lib/project-activity'
import { CliFinishNotice } from '@renderer/lib/cli-finish-notice'
import { useActivityAttentionStore } from '@renderer/stores/activity-attention-store'
import { useNotificationStore } from '@renderer/stores/notification-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

interface TerminalStore {
  sessions: Record<string, PtySessionStatus>
  errors: Record<string, string | undefined>
  outputTails: Record<string, string>
  /** CLI sessions showing an approval or question prompt right now. */
  asking: Record<string, boolean>
  /** When each session last started working, for "working 2m". */
  busySince: Record<string, number>

  setStatus: (sessionId: string, status: PtySessionStatus, error?: string) => void
  setOutputTail: (sessionId: string, tail: string) => void
  setAsking: (sessionId: string, asking: boolean) => void
  /** The user sent this CLI input (a prompt, an answer): its next finish may be announced. */
  noteInput: (sessionId: string) => void
  removeSession: (sessionId: string) => void
  getStatus: (sessionId: string) => PtySessionStatus | undefined
  getOutputTail: (sessionId: string) => string
}

function notifyCliTaskFinish(sessionId: string, outcome: ProcessFinishOutcome): string | null {
  const workspace = useWorkspaceStore.getState()
  const owner = findPanelProject(sessionId, workspace.workspaces)
  if (!owner || !isWatchedCliPanel(owner.panel)) return null
  // A CLI that stopped to ask a question has not finished; the question is its own notice.
  if (useTerminalStore.getState().asking[sessionId]) return null
  // Panels working for the Manager are summarised in its own completion notice.
  if (owner.panel.panelRole === 'secretary') return null
  const project = workspace.projects.find((item) => item.id === owner.projectId)
  return useActivityAttentionStore.getState().noteFinish({
    projectId: owner.projectId,
    panelId: sessionId,
    projectName: project?.name ?? 'Project',
    title: owner.panel.title,
    outcome
  })
}

const finishNotice = new CliFinishNotice({
  notify: notifyCliTaskFinish,
  retract: (sessionId, noticeId) => {
    useNotificationStore.getState().retract(noticeId)
    useActivityAttentionStore.getState().clearPanel(sessionId)
  },
  isStillFinished: (sessionId) => {
    const state = useTerminalStore.getState()
    const status = state.sessions[sessionId]
    return (status === 'waiting' || status === 'stopped') && !state.asking[sessionId]
  }
})

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: {},
  errors: {},
  outputTails: {},
  asking: {},
  busySince: {},

  setStatus: (sessionId, status, error) => {
    const prev = get().sessions[sessionId]
    if (prev === status && get().errors[sessionId] === error) return
    set((state) => {
      const working = status === 'busy' || status === 'starting'
      const wasWorking = prev === 'busy' || prev === 'starting'
      let busySince = state.busySince
      if (working && !wasWorking) busySince = { ...busySince, [sessionId]: Date.now() }
      if (!working && sessionId in busySince) {
        const { [sessionId]: _done, ...rest } = busySince
        busySince = rest
      }
      let asking = state.asking
      if ((status === 'stopped' || status === 'error') && asking[sessionId]) {
        const { [sessionId]: _gone, ...rest } = asking
        asking = rest
      }
      return {
        sessions: { ...state.sessions, [sessionId]: status },
        errors: { ...state.errors, [sessionId]: error },
        busySince,
        asking
      }
    })
    finishNotice.onStatus(sessionId, prev, status)
  },

  setOutputTail: (sessionId, tail) => {
    if (get().outputTails[sessionId] === tail) return
    set((state) => ({
      outputTails: { ...state.outputTails, [sessionId]: tail }
    }))
  },

  setAsking: (sessionId, asking) => {
    if (Boolean(get().asking[sessionId]) === asking) return
    set((state) => {
      if (asking) return { asking: { ...state.asking, [sessionId]: true } }
      const { [sessionId]: _gone, ...rest } = state.asking
      return { asking: rest }
    })
  },

  noteInput: (sessionId) => finishNotice.noteInput(sessionId),

  removeSession: (sessionId) => {
    finishNotice.forget(sessionId)
    set((state) => {
      const { [sessionId]: _s, ...sessions } = state.sessions
      const { [sessionId]: _e, ...errors } = state.errors
      const { [sessionId]: _t, ...outputTails } = state.outputTails
      const { [sessionId]: _a, ...asking } = state.asking
      const { [sessionId]: _b, ...busySince } = state.busySince
      return { sessions, errors, outputTails, asking, busySince }
    })
  },

  getStatus: (sessionId) => get().sessions[sessionId],
  getOutputTail: (sessionId) => get().outputTails[sessionId] ?? ''
}))
