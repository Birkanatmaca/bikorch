import { useEffect } from 'react'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { useGitStore } from '@renderer/stores/git-store'

export function StatusBar(): React.JSX.Element {
  const { projectId, projectName, projectRoot } = useActiveProject()
  const refresh = useGitStore((s) => s.refresh)

  useEffect(() => {
    if (!projectId || !projectRoot) return
    void refresh(projectId, projectRoot)
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
        <span className="hidden sm:inline">Ctrl+K commands</span>
      </div>
    </footer>
  )
}
