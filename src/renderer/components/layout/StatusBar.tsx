import { useEffect } from 'react'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { useGitStatusBar, useGitStore } from '@renderer/stores/git-store'
import { useIsolationStore } from '@renderer/stores/isolation-store'
import { GitBranch, FolderOpen, Command, LayoutGrid, Minus, Plus } from 'lucide-react'
import { isMacOS } from '@renderer/lib/electron-api'
import { COMMAND_PALETTE_EVENT } from '@renderer/lib/app-events'
import { Button } from '@renderer/components/ui/Button'
import { StatusChip } from '@renderer/components/ui/StatusChip'
import { cn } from '@renderer/lib/utils'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import {
  WORKSPACE_SCALE_MAX,
  WORKSPACE_SCALE_MIN,
  WORKSPACE_SCALE_STEP
} from '@shared/types'

export function StatusBar(): React.JSX.Element {
  const { projectId, projectName, projectRoot } = useActiveProject()
  const refresh = useGitStore((s) => s.refresh)
  const inspectIsolation = useIsolationStore((s) => s.inspect)
  const gitStatus = useGitStatusBar(projectId)
  const workspaceScale = useWorkspaceStore((s) => s.workspaceScale)
  const setWorkspaceScale = useWorkspaceStore((s) => s.setWorkspaceScale)
  const nudgeWorkspaceScale = useWorkspaceStore((s) => s.nudgeWorkspaceScale)
  const canvasMode = useWorkspaceStore((s) => {
    const workspace = s.getActiveWorkspace()
    return workspace?.layout.canvasMode ?? 'free'
  })
  const setCanvasMode = useWorkspaceStore((s) => s.setCanvasMode)
  const tiled = canvasMode === 'tiled'

  useEffect(() => {
    if (!projectId || !projectRoot) return
    void refresh(projectId, projectRoot)
    void inspectIsolation(projectId, projectRoot)
  }, [projectId, projectRoot, refresh, inspectIsolation])

  useEffect(() => {
    if (!projectId || !projectRoot) return

    const refreshQuietly = (): void => {
      if (document.visibilityState === 'visible') {
        void refresh(projectId, projectRoot, { quiet: true })
        void inspectIsolation(projectId, projectRoot)
      }
    }

    const timer = window.setInterval(refreshQuietly, 2500)
    document.addEventListener('visibilitychange', refreshQuietly)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshQuietly)
    }
  }, [projectId, projectRoot, refresh, inspectIsolation])

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
        <button
          type="button"
          className={cn('status-layout-btn', tiled && 'is-on')}
          onClick={() => setCanvasMode(tiled ? 'free' : 'tiled')}
          disabled={!projectId}
          title={
            tiled
              ? 'Switch to free workspace — floating windows'
              : 'Tile workspace — equal cells, swap and split'
          }
          aria-pressed={tiled}
          aria-label={tiled ? 'Tiled workspace on' : 'Tiled workspace off'}
        >
          <LayoutGrid className="h-3 w-3" aria-hidden />
          {tiled ? 'Tiled' : 'Free'}
        </button>
        <div className="status-zoom" title="Workspace scale">
          <button
            type="button"
            className="status-zoom-btn"
            onClick={() => nudgeWorkspaceScale(-1)}
            disabled={workspaceScale <= WORKSPACE_SCALE_MIN}
            aria-label="Zoom workspace out"
          >
            <Minus className="h-3 w-3" aria-hidden />
          </button>
          <input
            className="status-zoom-slider"
            type="range"
            min={WORKSPACE_SCALE_MIN}
            max={WORKSPACE_SCALE_MAX}
            step={WORKSPACE_SCALE_STEP}
            value={workspaceScale}
            onChange={(event) => setWorkspaceScale(Number(event.target.value))}
            aria-label="Workspace scale"
          />
          <button
            type="button"
            className="status-zoom-value"
            onClick={() => setWorkspaceScale(100)}
            title="Reset workspace scale to 100"
            aria-label={`Workspace scale ${workspaceScale} percent. Click to reset.`}
          >
            {workspaceScale}%
          </button>
          <button
            type="button"
            className="status-zoom-btn"
            onClick={() => nudgeWorkspaceScale(1)}
            disabled={workspaceScale >= WORKSPACE_SCALE_MAX}
            aria-label="Zoom workspace in"
          >
            <Plus className="h-3 w-3" aria-hidden />
          </button>
        </div>
        <Button variant="ghost" className="status-command" onClick={() => window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT))}>
          <Command className="h-3 w-3" aria-hidden />
          Commands <kbd>{isMacOS() ? '⌘ K' : 'Ctrl K'}</kbd>
        </Button>
      </div>
    </footer>
  )
}
