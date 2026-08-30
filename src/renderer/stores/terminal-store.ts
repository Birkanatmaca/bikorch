import { create } from 'zustand'
import type { PtySessionStatus } from '@shared/contracts/pty'

interface TerminalStore {
  sessions: Record<string, PtySessionStatus>
  errors: Record<string, string | undefined>

  setStatus: (sessionId: string, status: PtySessionStatus, error?: string) => void
  removeSession: (sessionId: string) => void
  getStatus: (sessionId: string) => PtySessionStatus | undefined
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: {},
  errors: {},

  setStatus: (sessionId, status, error) => {
    set((state) => ({
      sessions: { ...state.sessions, [sessionId]: status },
      errors: { ...state.errors, [sessionId]: error }
    }))
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
