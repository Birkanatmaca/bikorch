import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, ClipboardList, MessageCircleQuestion, X } from 'lucide-react'
import { useNotificationStore, type AppNotice, type AppNoticeKind } from '@renderer/stores/notification-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { focusWorkspacePanel, OPEN_MANAGER_EVENT } from '@renderer/lib/app-events'
import { cn } from '@renderer/lib/utils'

const KIND_LABEL: Record<AppNoticeKind, string> = {
  done: 'Completed',
  failed: 'Failed',
  'needs-input': 'Needs your answer',
  'plan-ready': 'Plan ready'
}

function KindIcon({ kind }: { kind: AppNoticeKind }): React.JSX.Element {
  if (kind === 'done') return <CheckCircle2 className="h-4 w-4" aria-hidden />
  if (kind === 'failed') return <AlertTriangle className="h-4 w-4" aria-hidden />
  if (kind === 'needs-input') return <MessageCircleQuestion className="h-4 w-4" aria-hidden />
  return <ClipboardList className="h-4 w-4" aria-hidden />
}

function timeAgo(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(at).toLocaleDateString()
}

/** Brings the user to where the notice happened. */
function useNoticeActions(): {
  openManager: (notice: AppNotice) => void
  reviewChanges: (notice: AppNotice) => void
  showPanel: (notice: AppNotice) => void
} {
  const setActiveProject = useWorkspaceStore((state) => state.setActiveProject)
  const selectLeftSidebar = useWorkspaceStore((state) => state.selectLeftSidebar)
  const go = (notice: AppNotice): void => {
    useNotificationStore.getState().markRead(notice.id)
    // setActiveProject also leaves the home screen.
    setActiveProject(notice.projectId)
  }
  return {
    openManager: (notice) => {
      go(notice)
      window.setTimeout(() => window.dispatchEvent(new Event(OPEN_MANAGER_EVENT)), 60)
    },
    reviewChanges: (notice) => {
      go(notice)
      selectLeftSidebar(notice.projectId, 'changes')
    },
    showPanel: (notice) => {
      go(notice)
      const panelId = notice.panelIds[0]
      if (panelId) window.setTimeout(() => focusWorkspacePanel(panelId), 60)
    }
  }
}

function NoticeBody({ notice, compact = false }: { notice: AppNotice; compact?: boolean }): React.JSX.Element {
  const actions = useNoticeActions()
  const fromManager = notice.source === 'Manager'
  return (
    <>
      <div className="app-notice-head">
        <span className={cn('app-notice-icon', `is-${notice.kind}`)}>
          <KindIcon kind={notice.kind} />
        </span>
        <span className="app-notice-meta">
          {notice.source} · {notice.projectName} · {KIND_LABEL[notice.kind]}
        </span>
      </div>
      <p className="app-notice-headline">{notice.headline}</p>
      {!compact && notice.highlights.length > 0 && (
        <ul className="app-notice-highlights">
          {notice.highlights.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
      {!compact && notice.changedFiles > 0 && (
        <p className="app-notice-facts">
          {notice.changedFiles} file{notice.changedFiles === 1 ? '' : 's'} changed (seen in Git)
        </p>
      )}
      <div className="app-notice-actions">
        {fromManager && notice.changedFiles > 0 && (
          <button type="button" className="is-primary" onClick={() => actions.reviewChanges(notice)}>
            Review changes
          </button>
        )}
        {fromManager ? (
          <button type="button" onClick={() => actions.openManager(notice)}>
            {notice.kind === 'needs-input' ? 'Answer' : notice.kind === 'plan-ready' ? 'Review plan' : 'Open report'}
          </button>
        ) : (
          <button type="button" onClick={() => actions.showPanel(notice)}>
            Show panel
          </button>
        )}
      </div>
    </>
  )
}

function Toast({ notice }: { notice: AppNotice }): React.JSX.Element {
  const dismiss = useNotificationStore((state) => state.dismissToast)
  const [hovered, setHovered] = useState(false)
  // Failures and questions stay until handled; good news leaves on its own.
  const sticky = notice.kind === 'failed' || notice.kind === 'needs-input'
  useEffect(() => {
    if (sticky || hovered) return
    const timer = window.setTimeout(() => dismiss(notice.id), 12_000)
    return () => window.clearTimeout(timer)
  }, [dismiss, hovered, notice.id, sticky])
  return (
    <div
      className={cn('app-notice-toast', `is-${notice.kind}`)}
      role={sticky ? 'alert' : 'status'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button type="button" className="app-notice-close" aria-label="Dismiss" onClick={() => dismiss(notice.id)}>
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
      <NoticeBody notice={notice} />
    </div>
  )
}

/** Bottom-right stack of live notices. */
export function NotificationToasts(): React.JSX.Element | null {
  const toastIds = useNotificationStore((state) => state.toastIds)
  const notices = useNotificationStore((state) => state.notices)
  const visible = toastIds.map((id) => notices.find((notice) => notice.id === id)).filter((notice): notice is AppNotice => Boolean(notice))
  if (visible.length === 0) return null
  return (
    <div className="app-notice-stack" aria-live="polite">
      {visible.map((notice) => (
        <Toast key={notice.id} notice={notice} />
      ))}
    </div>
  )
}

/** Header bell with unread count and the recent history. */
export function NotificationCenter(): React.JSX.Element {
  const notices = useNotificationStore((state) => state.notices)
  const open = useNotificationStore((state) => state.centerOpen)
  const setOpen = useNotificationStore((state) => state.setCenterOpen)
  const unread = notices.filter((notice) => !notice.read).length
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  return (
    <div ref={rootRef} className="app-notice-center">
      <button
        type="button"
        className={cn('app-notice-bell', open && 'is-open')}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        onClick={() => setOpen(!open)}
      >
        <Bell className="h-3.5 w-3.5" aria-hidden />
        {unread > 0 && <span className="app-notice-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="app-notice-panel" role="dialog" aria-label="Notifications">
          <div className="app-notice-panel-head">
            <span>Notifications</span>
            {notices.length > 0 && (
              <span className="app-notice-panel-tools">
                {unread > 0 && (
                  <button type="button" onClick={() => useNotificationStore.getState().markAllRead()}>
                    Mark all read
                  </button>
                )}
                <button type="button" onClick={() => useNotificationStore.getState().clear()}>
                  Clear
                </button>
              </span>
            )}
          </div>
          {notices.length === 0 ? (
            <p className="app-notice-empty">When the Manager or a CLI finishes work, you will see what it did here.</p>
          ) : (
            <ul className="app-notice-list">
              {notices.map((notice) => (
                <li key={notice.id} className={cn('app-notice-item', !notice.read && 'is-unread')}>
                  <NoticeBody notice={notice} compact={notice.read} />
                  <span className="app-notice-time">{timeAgo(notice.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
