import { useEffect } from 'react'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { useGitStatusBar, useGitStore } from '@renderer/stores/git-store'

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
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-panel-bg px-3 font-mono text-[10px] text-text-muted">
      <div className="flex min-w-0 items-center gap-3">
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
            <span className="text-primary">{gitStatus.branch ?? 'detached'}</span>
            <span className={gitStatus.changesCount > 0 ? 'text-warning' : 'text-success'}>
              {gitStatus.changesCount > 0 ? `${gitStatus.changesCount} changes` : 'clean'}
            </span>
          </>
        )}
        <span className="hidden sm:inline">Ctrl+K commands</span>
      </div>
    </footer>
  )
}
