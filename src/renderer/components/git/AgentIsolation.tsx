import { useMemo, useState } from 'react'
import type { AgentWorktreeKind, IsolationLane } from '@shared/contracts/git'
import { AGENT_WORKTREE_KINDS } from '@shared/contracts/git'
import { buildConflictResolvePrompt } from '@shared/lib/isolation-prompt'
import { PANEL_TYPE_LABELS, type PanelType } from '@shared/types'
import { focusTerminal, focusWorkspacePanel } from '@renderer/lib/app-events'
import { cn } from '@renderer/lib/utils'
import { useEditorStore } from '@renderer/stores/editor-store'
import { selectIsolationState, useIsolationStore } from '@renderer/stores/isolation-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useGitStore } from '@renderer/stores/git-store'
import { Loader2 } from 'lucide-react'

const SHORT_KIND: Record<AgentWorktreeKind, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  codex: 'Codex'
}

function kindLabel(kind: AgentWorktreeKind): string {
  return SHORT_KIND[kind] ?? PANEL_TYPE_LABELS[kind as PanelType] ?? kind
}

export function AgentIsolationBlock({
  projectId,
  projectRoot
}: {
  projectId: string
  projectRoot: string
}): React.JSX.Element | null {
  const snapshot = useIsolationStore((state) => selectIsolationState(state.byProject, projectId))
  const foldLane = useIsolationStore((state) => state.fold)
  const acceptFold = useIsolationStore((state) => state.accept)
  const abortFold = useIsolationStore((state) => state.abort)
  const openFoldReview = useEditorStore((state) => state.openFoldReview)
  const panels = useWorkspaceStore((state) => state.workspaces[projectId]?.panels ?? [])
  const sessions = useTerminalStore((state) => state.sessions)
  const [busyLane, setBusyLane] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)

  const overlapByPanel = useMemo(() => {
    const map = new Set<string>()
    for (const overlap of snapshot.overlaps) {
      for (const id of overlap.panelIds) map.add(id)
    }
    return map
  }, [snapshot.overlaps])

  const { resolvers, kindCounts } = useMemo(() => {
    const list = panels.filter((panel) => {
      if (!(AGENT_WORKTREE_KINDS as readonly string[]).includes(panel.type)) return false
      const status = sessions[panel.id]
      return status === 'running' || status === 'waiting' || status === 'busy'
    })
    const counts = new Map<string, number>()
    for (const panel of list) {
      counts.set(panel.type, (counts.get(panel.type) ?? 0) + 1)
    }
    return { resolvers: list, kindCounts: counts }
  }, [panels, sessions])

  if (snapshot.lanes.length === 0 && !snapshot.fold && !snapshot.error && !snapshot.notice) {
    return null
  }

  const fold = snapshot.fold
  const reviewing = fold && fold.status !== 'empty' && fold.files.length > 0

  const handleFold = async (lane: IsolationLane): Promise<void> => {
    setBusyLane(lane.panelId)
    try {
      await foldLane(projectId, projectRoot, {
        panelId: lane.panelId,
        kind: lane.kind,
        title: lane.title,
        worktreePath: lane.worktreePath
      })
    } finally {
      setBusyLane(null)
    }
  }

  const handleReview = (filePath?: string): void => {
    if (!fold) return
    const files = fold.status === 'conflict' ? fold.conflicts.map((file) => file.path) : fold.files
    if (files.length === 0) return
    void openFoldReview(projectId, projectRoot, files, filePath)
  }

  const handleAccept = async (): Promise<void> => {
    const ok = await acceptFold(projectId, projectRoot)
    if (ok) {
      void useGitStore.getState().refresh(projectId, projectRoot)
    }
  }

  const handleResolve = async (panelId: string, kind: AgentWorktreeKind, title: string): Promise<void> => {
    if (!fold || fold.status !== 'conflict' || fold.conflicts.length === 0) return
    const others = snapshot.lanes.filter((lane) => lane.panelId !== fold.panelId).map((lane) => lane.title)
    const prompt = buildConflictResolvePrompt({
      task: fold.title,
      resolverLabel: title || kindLabel(kind),
      otherLabels: others,
      files: fold.conflicts
    })
    setResolving(true)
    try {
      await window.api.pty.write({
        sessionId: panelId,
        data: `\u001b[200~${prompt}\u001b[201~\r`
      })
      focusWorkspacePanel(panelId)
      focusTerminal(panelId)
    } finally {
      setResolving(false)
    }
  }

  return (
    <section className="iso-block">
      {snapshot.lanes.length > 0 && (
        <div className="iso-section">
          <p className="iso-heading">
            Agents <span>{snapshot.lanes.length}</span>
          </p>
          <div className="iso-lanes">
            {snapshot.lanes.map((lane) => {
              const overlapping = overlapByPanel.has(lane.panelId)
              const folding = busyLane === lane.panelId || (snapshot.loading && fold?.panelId === lane.panelId)
              return (
                <div key={lane.panelId} className="iso-lane">
                  <div className="iso-lane-meta">
                    <span className="iso-lane-title" title={lane.title}>
                      {lane.title}
                    </span>
                    <span className="iso-lane-kind">{kindLabel(lane.kind)}</span>
                    <span className={cn('iso-lane-files', overlapping && 'is-overlap')}>
                      {overlapping ? 'overlap' : `${lane.files.length} file${lane.files.length === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="iso-btn"
                    disabled={Boolean(busyLane) || snapshot.loading}
                    onClick={() => void handleFold(lane)}
                  >
                    {folding ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Fold'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {snapshot.overlaps.length > 0 && (
        <div className="iso-section">
          <p className="iso-heading">
            Overlap <span>{snapshot.overlaps.length}</span>
          </p>
          <ul className="iso-overlap-list">
            {snapshot.overlaps.slice(0, 12).map((overlap) => (
              <li key={overlap.path}>
                <span className="iso-overlap-path">{overlap.path}</span>
                <span className="iso-overlap-owners">{overlap.labels.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fold && fold.status !== 'empty' && (
        <div className={cn('iso-fold', fold.status === 'conflict' && 'is-conflict')}>
          {fold.status === 'conflict' ? (
            <>
              <p className="iso-heading">Merge conflict</p>
              <p className="iso-fold-title">
                {fold.title}
                {fold.conflicts.length > 0 ? ` · ${fold.conflicts.map((file) => file.path).join(', ')}` : ''}
              </p>
              <div className="iso-actions">
                <button type="button" className="iso-btn" onClick={() => handleReview()} disabled={!reviewing}>
                  Review Conflict
                </button>
                {resolvers.map((panel) => (
                  <button
                    key={panel.id}
                    type="button"
                    className="iso-btn iso-btn-primary"
                    disabled={resolving}
                    onClick={() => void handleResolve(panel.id, panel.type as AgentWorktreeKind, panel.title)}
                  >
                    {`Resolve with ${(kindCounts.get(panel.type) ?? 0) > 1 ? panel.title : kindLabel(panel.type as AgentWorktreeKind)}`}
                  </button>
                ))}
                <button type="button" className="iso-btn" onClick={() => handleReview()}>
                  Resolve Manually
                </button>
              </div>
              <div className="iso-actions">
                <button type="button" className="iso-btn" onClick={() => handleReview()}>
                  Review Diff
                </button>
                <button
                  type="button"
                  className="iso-btn iso-btn-primary"
                  disabled={snapshot.loading}
                  onClick={() => void handleAccept()}
                >
                  Accept Resolution
                </button>
                <button type="button" className="iso-btn" onClick={() => void abortFold(projectId, projectRoot)}>
                  Abort
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="iso-heading">Ready to fold</p>
              <p className="iso-fold-title">
                {fold.title}
                {fold.files.length > 0 ? ` · ${fold.files.join(', ')}` : ''}
              </p>
              <div className="iso-actions">
                <button type="button" className="iso-btn" onClick={() => handleReview()} disabled={!reviewing}>
                  Review Diff
                </button>
                <button
                  type="button"
                  className="iso-btn iso-btn-primary"
                  disabled={snapshot.loading}
                  onClick={() => void handleAccept()}
                >
                  Accept
                </button>
                <button type="button" className="iso-btn" onClick={() => void abortFold(projectId, projectRoot)}>
                  Abort
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {snapshot.notice && <p className="iso-notice">{snapshot.notice}</p>}
      {snapshot.error && <p className="iso-error">{snapshot.error}</p>}
    </section>
  )
}
