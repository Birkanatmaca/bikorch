import { useEffect } from 'react'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { useGitStatusBar, useGitStore } from '@renderer/stores/git-store'
import { GitBranch, FolderOpen, Command } from 'lucide-react'
import { isMacOS } from '@renderer/lib/electron-api'
import { COMMAND_PALETTE_EVENT } from '@renderer/lib/app-events'
import { Button } from '@renderer/components/ui/Button'
import { StatusChip } from '@renderer/components/ui/StatusChip'

export function StatusBar(): React.JSX.Element {
  const { projectId, projectName, projectRoot } = useActiveProject()
  const refresh = useGitStore((s) => s.refresh)
  const gitStatus = useGitStatusBar(projectId)

  useEffect(() => {
    if (!projectId || !projectRoot) return
    void refresh(projectId, projectRoot)
  }, [projectId, projectRoot, refresh])

  useEffect(() => {
    if (!projectId || !projectRoot) return

    const refreshQuietly = (): void => {
      if (document.visibilityState === 'visible') {
        void refresh(projectId, projectRoot, { quiet: true })
      }
    }

    const timer = window.setInterval(refreshQuietly, 2500)
    document.addEventListener('visibilitychange', refreshQuietly)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshQuietly)
    }
  }, [projectId, projectRoot, refresh])

  return (
    <footer className="app-status-bar glass-surface flex h-6 shrink-0 items-center justify-between border-t px-3 font-mono text-[10px] text-text-muted">
      <div className="flex min-w-0 items-center gap-2">
        <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate text-text-secondary">{projectName ?? 'No project'}</span>
        {projectRoot && (
          <>
            <span className="text-border">·</span>
            <span className="max-w-[240px] truncate">{projectRoot}</span>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {gitStatus.isRepo && (
          <>
            <span className="flex items-center gap-1.5 text-text-secondary"><GitBranch className="h-3 w-3" aria-hidden />{gitStatus.branch ?? 'detached'}</span>
            <StatusChip tone={gitStatus.changesCount > 0 ? 'warning' : 'success'}>
              {gitStatus.changesCount > 0 ? `${gitStatus.changesCount} changes` : 'clean'}
            </StatusChip>
          </>
        )}
        <Button variant="ghost" className="status-command" onClick={() => window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT))}>
          <Command className="h-3 w-3" aria-hidden />
          Commands <kbd>{isMacOS() ? '⌘ K' : 'Ctrl K'}</kbd>
        </Button>
      </div>
    </footer>
  )
}
