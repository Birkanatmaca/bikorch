import { create } from 'zustand'

export type AppNoticeKind = 'done' | 'failed' | 'needs-input' | 'plan-ready'

export interface AppNotice {
  id: string
  kind: AppNoticeKind
  projectId: string
  projectName: string
  /** Who did the work: "Manager", "Claude Code", … */
  source: string
  headline: string
  highlights: string[]
  /** Git-observed changed files, when known. */
  changedFiles: number
  at: number
  read: boolean
  /** Panels to reveal from "Review changes". */
  panelIds: string[]
  /** Manager run the notice belongs to, so "Open report" can scroll to it. */
  runId?: string
}

const STORAGE_KEY = 'bikorch:notifications'
const HISTORY_LIMIT = 40
const TOAST_LIMIT = 3

function load(): AppNotice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as AppNotice[]).filter((item) => item && typeof item.id === 'string').slice(0, HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

function save(notices: AppNotice[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notices.slice(0, HISTORY_LIMIT)))
  } catch {
    // History is a convenience; the live toast still shows.
  }
}

interface NotificationStore {
  /** Newest first. */
  notices: AppNotice[]
  /** Ids currently shown as toasts. */
  toastIds: string[]
  centerOpen: boolean
  push: (notice: Omit<AppNotice, 'id' | 'at' | 'read'>, options?: { toast?: boolean }) => AppNotice
  dismissToast: (id: string) => void
  markRead: (id: string) => void
  markAllRead: () => void
  clear: () => void
  setCenterOpen: (open: boolean) => void
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notices: load(),
  toastIds: [],
  centerOpen: false,
  push: (input, options = {}) => {
    const notice: AppNotice = { ...input, id: `${input.source}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), read: false }
    const notices = [notice, ...get().notices].slice(0, HISTORY_LIMIT)
    save(notices)
    set((state) => ({
      notices,
      toastIds: options.toast === false ? state.toastIds : [notice.id, ...state.toastIds].slice(0, TOAST_LIMIT)
    }))
    return notice
  },
  dismissToast: (id) => set((state) => ({ toastIds: state.toastIds.filter((item) => item !== id) })),
  markRead: (id) => {
    const notices = get().notices.map((item) => (item.id === id ? { ...item, read: true } : item))
    save(notices)
    set({ notices })
  },
  markAllRead: () => {
    const notices = get().notices.map((item) => ({ ...item, read: true }))
    save(notices)
    set({ notices })
  },
  clear: () => {
    save([])
    set({ notices: [], toastIds: [] })
  },
  setCenterOpen: (open) => set({ centerOpen: open })
}))
