import { useMemo, useState } from 'react'
import type { AgentWorktreeKind, IsolationLane } from '@shared/contracts/git'
import { AGENT_WORKTREE_KINDS } from '@shared/contracts/git'
import { buildConflictResolvePrompt } from '@shared/lib/isolation-prompt'
import { submitCliPrompt } from '@renderer/lib/submit-cli-prompt'
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

async function waitForSession(sessionId: string, timeoutMs = 12_000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = useTerminalStore.getState().sessions[sessionId]
    if (status === 'running' || status === 'waiting' || status === 'busy') return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
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
  const syncFold = useIsolationStore((state) => state.sync)
  const acceptFold = useIsolationStore((state) => state.accept)
  const abortFold = useIsolationStore((state) => state.abort)
  const discardRun = useIsolationStore((state) => state.discard)
  const openFoldReview = useEditorStore((state) => state.openFoldReview)
  const reopenAgentRun = useWorkspaceStore((state) => state.reopenAgentRun)
  const openResolverPanel = useWorkspaceStore((state) => state.openResolverPanel)
  const [busyLane, setBusyLane] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)

  const overlapByPanel = useMemo(() => {
    const map = new Set<string>()
    for (const overlap of snapshot.overlaps) {
      for (const id of overlap.panelIds) map.add(id)
    }
    return map
  }, [snapshot.overlaps])

  if (
    snapshot.lanes.length === 0 &&
    !snapshot.fold &&
    snapshot.recoveries.length === 0 &&
    !snapshot.error &&
    !snapshot.notice
  ) {
    return null
  }

  const fold = snapshot.fold
  const reviewing = fold && fold.status !== 'empty' && fold.files.length > 0
  const acceptBlocked = Boolean(fold?.stale) || snapshot.loading

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

  const handleResolve = async (): Promise<void> => {
    if (!fold || fold.status !== 'conflict' || !fold.integrationPath || fold.conflicts.length === 0) return
    const others = snapshot.lanes.filter((lane) => lane.panelId !== fold.panelId).map((lane) => lane.title)
    const prompt = buildConflictResolvePrompt({
      task: fold.title,
      resolverLabel: kindLabel(fold.kind),
      otherLabels: others,
      files: fold.conflicts,
      integrationPath: fold.integrationPath
    })
    setResolving(true)
    try {
      const panelId = openResolverPanel(fold.kind, `Resolver · ${fold.title}`, fold.integrationPath)
      focusWorkspacePanel(panelId)
      focusTerminal(panelId)
      const ready = await waitForSession(panelId)
      if (ready) await submitCliPrompt(panelId, prompt)
    } finally {
      setResolving(false)
    }
  }

  const handleDiscard = async (runId: string): Promise<void> => {
    if (
      !window.confirm(
        'Discard this agent copy? The Git branch is kept. The worktree is removed only if it is clean after a checkpoint.'
      )
    ) {
      return
    }
    await discardRun(projectId, projectRoot, runId)
  }

  return (
    <section className="iso-block">
      {snapshot.lanes.length > 0 && (
        <div className="iso-section">
          <p className="iso-heading">
            Agent runs <span>{snapshot.lanes.length}</span>
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
                      {lane.isolationState === 'parked'
                        ? 'parked'
                        : overlapping
                          ? 'overlap'
                          : `${lane.files.length} file${lane.files.length === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <div className="iso-lane-actions">
                    {!lane.attached && (
                      <button
                        type="button"
                        className="iso-btn"
                        onClick={() => reopenAgentRun(lane.runId, lane.kind, lane.title)}
                      >
                        Reopen
                      </button>
                    )}
                    <button
                      type="button"
                      className="iso-btn"
                      disabled={Boolean(busyLane) || snapshot.loading}
                      onClick={() => void handleFold(lane)}
                    >
                      {folding ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Fold'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {snapshot.recoveries.length > 0 && (
        <div className="iso-section">
          <p className="iso-heading">
            Recover <span>{snapshot.recoveries.length}</span>
          </p>
          <div className="iso-lanes">
            {snapshot.recoveries.map((recovery) => (
              <div key={recovery.runId} className="iso-lane">
                <div className="iso-lane-meta">
                  <span className="iso-lane-title" title={recovery.reason}>
                    {recovery.title}
                  </span>
                  <span className="iso-lane-kind">{kindLabel(recovery.kind)}</span>
                  <span className="iso-lane-files">{recovery.status}</span>
                </div>
                <div className="iso-lane-actions">
                  {recovery.actions.includes('resume') && (
                    <button
                      type="button"
                      className="iso-btn iso-btn-primary"
                      onClick={() => reopenAgentRun(recovery.runId, recovery.kind, recovery.title)}
                    >
                      Resume
                    </button>
                  )}
                  {recovery.actions.includes('review') && (
                    <button type="button" className="iso-btn" onClick={() => handleReview()}>
                      Review
                    </button>
                  )}
                  {recovery.actions.includes('discard') && (
                    <button type="button" className="iso-btn" onClick={() => void handleDiscard(recovery.runId)}>
                      Discard
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {snapshot.queue.length > 0 && (
        <div className="iso-section">
          <p className="iso-heading">
            Merge queue <span>{snapshot.queue.length}</span>
          </p>
          <ul className="iso-overlap-list">
            {snapshot.queue.map((item) => (
              <li key={item.runId}>
                <span className="iso-overlap-path">{item.title}</span>
                <span className="iso-overlap-owners">
                  {item.status}
                  {item.fileCount > 0 ? ` · ${item.fileCount}` : ''}
                </span>
              </li>
            ))}
          </ul>
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
        <div className={cn('iso-fold', fold.status === 'conflict' && 'is-conflict', fold.stale && 'is-stale')}>
          {fold.validation && (
            <p className="iso-notice">
              Validation
              {fold.validation.typecheck
                ? ` · typecheck ${fold.validation.typecheck.skipped ? 'skipped' : fold.validation.typecheck.ok ? 'ok' : 'fail'}`
                : ''}
              {fold.validation.test
                ? ` · test ${fold.validation.test.ok ? 'ok' : 'fail'}`
                : ''}
              {fold.validation.build
                ? ` · build ${fold.validation.build.ok ? 'ok' : 'fail'}`
                : ''}
            </p>
          )}
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
                <button
                  type="button"
                  className="iso-btn iso-btn-primary"
                  disabled={resolving || !fold.integrationPath}
                  onClick={() => void handleResolve()}
                >
                  {resolving ? <Loader2 className="h-3 w-3 animate-spin" /> : `Resolve in ${kindLabel(fold.kind)}`}
                </button>
                <button type="button" className="iso-btn" onClick={() => handleReview()}>
                  Resolve Manually
                </button>
              </div>
              <div className="iso-actions">
                {fold.stale && (
                  <button
                    type="button"
                    className="iso-btn iso-btn-primary"
                    disabled={snapshot.loading}
                    onClick={() => void syncFold(projectId, projectRoot)}
                  >
                    Sync target
                  </button>
                )}
                <button type="button" className="iso-btn" onClick={() => handleReview()}>
                  Review Diff
                </button>
                <button
                  type="button"
                  className="iso-btn iso-btn-primary"
                  disabled={acceptBlocked}
                  onClick={() => void handleAccept()}
                >
                  Accept squash
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
                {fold.stale && (
                  <button
                    type="button"
                    className="iso-btn iso-btn-primary"
                    disabled={snapshot.loading}
                    onClick={() => void syncFold(projectId, projectRoot)}
                  >
                    Sync target
                  </button>
                )}
                <button type="button" className="iso-btn" onClick={() => handleReview()} disabled={!reviewing}>
                  Review Diff
                </button>
                <button
                  type="button"
                  className="iso-btn iso-btn-primary"
                  disabled={acceptBlocked}
                  onClick={() => void handleAccept()}
                >
                  Accept squash
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
