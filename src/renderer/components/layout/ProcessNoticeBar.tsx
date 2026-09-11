import { useActivityAttentionStore, type ProcessNotice } from '@renderer/stores/activity-attention-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { focusWorkspacePanel } from '@renderer/lib/app-events'
import { processNoticeBody } from '@renderer/lib/project-activity'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

function openNotice(notice: ProcessNotice): void {
  useWorkspaceStore.getState().setActiveProject(notice.projectId)
  useActivityAttentionStore.getState().clearProject(notice.projectId)
  useActivityAttentionStore.getState().dismissNotice(notice.id)
  window.setTimeout(() => {
    focusWorkspacePanel(notice.panelId)
  }, 40)
}

export function ProcessNoticeBar(): React.JSX.Element | null {
  const notices = useActivityAttentionStore((state) => state.notices)
  const dismissNotice = useActivityAttentionStore((state) => state.dismissNotice)
  if (notices.length === 0) return null

  return (
    <div className="process-notice-bar" role="status" aria-live="polite">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={cn('process-notice', notice.outcome === 'error' ? 'is-error' : 'is-done')}
        >
          <button
            type="button"
            className="process-notice-open"
            onClick={() => openNotice(notice)}
          >
            <span className="process-notice-dot" aria-hidden />
            <span className="process-notice-copy">
              {processNoticeBody(notice.outcome, notice.title, notice.projectName)}
              <span className="process-notice-hint">Open project</span>
            </span>
          </button>
          <button
            type="button"
            className="process-notice-dismiss"
            onClick={() => dismissNotice(notice.id)}
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
