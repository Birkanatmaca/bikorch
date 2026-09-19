import { useMemo, useState } from 'react'
import type { AgentWorktreeKind, IsolationFoldSession, IsolationLane } from '@shared/contracts/git'
import { buildConflictResolvePrompt } from '@shared/lib/isolation-prompt'
import { submitCliPrompt } from '@renderer/lib/submit-cli-prompt'
import { focusTerminal, focusWorkspacePanel } from '@renderer/lib/app-events'
import { cn } from '@renderer/lib/utils'
import { useEditorStore } from '@renderer/stores/editor-store'
import { selectIsolationState, useIsolationStore } from '@renderer/stores/isolation-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useGitStore } from '@renderer/stores/git-store'
import { Loader2 } from 'lucide-react'
import {
  APPLY_PHASES,
  agentKindLabel,
  applyPhaseIndex,
  buildAgentWorkCards,
  friendlyAgentWorkError,
  groupAgentWork,
  setupFailureDetail,
  type AgentWorkCard,
  type ApplyPhase
} from '@renderer/lib/agent-work'
import type { WorktreeDependencyMode, WorktreeLocalFileName } from '@shared/contracts/git'

const DEPENDENCY_MODES: Array<{
  id: WorktreeDependencyMode
  label: string
  hint: string
}> = [
  {
    id: 'isolated',
    label: 'Isolated',
    hint: 'Do not share dependencies.'
  },
  {
    id: 'share',
    label: 'Share existing node_modules',
    hint: 'Faster, but two agents can change the same tree.'
  },
  {
    id: 'setup',
    label: 'Run setup command',
    hint: 'Installs from the project lockfile inside this copy.'
  }
]

function visibleLocalFiles(
  available: WorktreeLocalFileName[],
  selected: WorktreeLocalFileName[]
): WorktreeLocalFileName[] {
  return [...new Set([...available, ...selected])]
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

function shortSha(value: string): string {
  return value.slice(0, 7)
}

export function AgentIsolationBlock({
  projectId,
  projectRoot
}: {
  projectId: string
  projectRoot: string
}): React.JSX.Element | null {
  const snapshot = useIsolationStore((state) => selectIsolationState(state.byProject, projectId))
  const prepareChanges = useIsolationStore((state) => state.fold)
  const syncChanges = useIsolationStore((state) => state.sync)
  const applyChanges = useIsolationStore((state) => state.accept)
  const cancelReview = useIsolationStore((state) => state.abort)
  const discardRun = useIsolationStore((state) => state.discard)
  const updateProvision = useIsolationStore((state) => state.updateProvision)
  const retrySetup = useIsolationStore((state) => state.retrySetup)
  const openFoldReview = useEditorStore((state) => state.openFoldReview)
  const reopenAgentRun = useWorkspaceStore((state) => state.reopenAgentRun)
  const openResolverPanel = useWorkspaceStore((state) => state.openResolverPanel)
  const sessions = useTerminalStore((state) => state.sessions)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [apply, setApply] = useState<{ id: string; phase: ApplyPhase } | null>(null)
  const [resolving, setResolving] = useState<AgentWorktreeKind | null>(null)

  const cards = useMemo(
    () =>
      buildAgentWorkCards({
        lanes: snapshot.lanes,
        overlaps: snapshot.overlaps,
        fold: snapshot.fold,
        sessions
      }),
    [snapshot.lanes, snapshot.overlaps, snapshot.fold, sessions]
  )
  const groups = useMemo(() => groupAgentWork(cards), [cards])
  const fold = snapshot.fold
  const localFiles = visibleLocalFiles(snapshot.availableLocalFiles, snapshot.provision.copyLocalFiles)
  const hasInbox = cards.length > 0 || Boolean(fold && fold.status !== 'empty')
  const hasSetup =
    localFiles.length > 0 ||
    snapshot.provision.copyLocalFiles.length > 0 ||
    Boolean(snapshot.targetBranch)

  if (!hasInbox && !hasSetup && !snapshot.error && !snapshot.notice && !snapshot.setupError) {
    return null
  }

  const laneFor = (card: AgentWorkCard): IsolationLane | undefined =>
    snapshot.lanes.find((item) => item.runId === card.runId)

  const ensurePrepared = async (lane: IsolationLane): Promise<IsolationFoldSession | null> => {
    const current = useIsolationStore.getState().byProject[projectId]?.fold ?? fold
    if (current && current.panelId === lane.panelId && current.status !== 'empty') {
      if (current.stale) return syncChanges(projectId, projectRoot)
      return current
    }
    return prepareChanges(projectId, projectRoot, {
      panelId: lane.panelId,
      kind: lane.kind,
      title: lane.title,
      worktreePath: lane.worktreePath
    })
  }

  const openReviewDiff = (session: IsolationFoldSession, filePath?: string): void => {
    const files = session.status === 'conflict' ? session.conflicts.map((file) => file.path) : session.files
    if (files.length === 0) return
    void openFoldReview(projectId, projectRoot, files, filePath)
  }

  const handleReview = async (card: AgentWorkCard): Promise<void> => {
    const lane = laneFor(card)
    if (!lane) return
    setExpandedId(card.id)
    setReviewingId(card.id)
    const session = await ensurePrepared(lane)
    if (session && session.status !== 'empty') openReviewDiff(session)
  }

  const handleApply = async (card: AgentWorkCard): Promise<void> => {
    const lane = laneFor(card)
    if (!lane || apply) return
    const confirmed = window.confirm(
      `Apply ${card.title || agentKindLabel(card.kind)} changes to the project? Review the diff first; this is a separate approval from starting the CLI task.`
    )
    if (!confirmed) return
    const current = useIsolationStore.getState().byProject[projectId]?.fold ?? fold
    const alreadyPrepared =
      Boolean(current) &&
      current?.panelId === lane.panelId &&
      current.status !== 'empty' &&
      !current.stale
    setExpandedId(card.id)
    setApply({ id: card.id, phase: alreadyPrepared ? 'applying' : 'preparing' })
    const stop = window.api.git?.onApplyPhase?.((event) => {
      if (event.panelId !== lane.panelId) return
      setApply({ id: card.id, phase: event.phase })
    })
    try {
      const session = await ensurePrepared(lane)
      if (!session || session.status === 'empty') {
        setApply({ id: card.id, phase: 'failed' })
        return
      }
      if (session.status === 'conflict') {
        setApply(null)
        setReviewingId(card.id)
        return
      }
      const ok = await applyChanges(projectId, projectRoot)
      if (ok) {
        void useGitStore.getState().refresh(projectId, projectRoot)
        setApply({ id: card.id, phase: 'done' })
        setReviewingId(null)
        window.setTimeout(() => {
          setApply((item) => (item?.id === card.id ? null : item))
          setExpandedId((item) => (item === card.id ? null : item))
        }, 1600)
        return
      }
      setApply({ id: card.id, phase: 'failed' })
    } catch {
      setApply({ id: card.id, phase: 'failed' })
    } finally {
      stop?.()
    }
  }

  const handleResolve = async (card: AgentWorkCard, kind: AgentWorktreeKind): Promise<void> => {
    const session = fold && fold.panelId === card.panelId ? fold : null
    const lane = laneFor(card)
    if (!lane) return
    let active = session
    if (!active || active.status !== 'conflict') {
      active = await ensurePrepared(lane)
    }
    if (!active || active.status !== 'conflict' || !active.integrationPath || active.conflicts.length === 0) {
      return
    }
    const others = snapshot.lanes.filter((item) => item.panelId !== card.panelId).map((item) => item.title)
    const prompt = buildConflictResolvePrompt({
      task: card.title,
      resolverLabel: agentKindLabel(kind),
      otherLabels: others,
      files: active.conflicts,
      integrationPath: active.integrationPath
    })
    setResolving(kind)
    try {
      const panelId = openResolverPanel(kind, `Resolve · ${card.title}`, active.integrationPath)
      focusWorkspacePanel(panelId)
      focusTerminal(panelId)
      const ready = await waitForSession(panelId)
      if (ready) await submitCliPrompt(panelId, prompt)
    } finally {
      setResolving(null)
    }
  }

  const handleDiscard = async (runId: string): Promise<void> => {
    if (!window.confirm('Discard this agent task? Finished work stays in its copy until the copy is clean.')) {
      return
    }
    await discardRun(projectId, projectRoot, runId)
  }

  const toggleLocalFile = (name: WorktreeLocalFileName, enabled: boolean): void => {
    const selected = new Set(snapshot.provision.copyLocalFiles)
    if (enabled) selected.add(name)
    else selected.delete(name)
    void updateProvision(projectId, projectRoot, {
      copyLocalFiles: [...selected],
      dependencyMode: snapshot.provision.dependencyMode
    })
  }

  const renderCard = (card: AgentWorkCard): React.JSX.Element => {
    const expanded = expandedId === card.id || reviewingId === card.id || apply?.id === card.id
    const session = fold?.panelId === card.panelId && fold.status !== 'empty' ? fold : null
    const reviewFiles = session?.files.length ? session.files : card.files
    const applying = apply?.id === card.id
    const phase = applying ? apply.phase : null
    const otherKinds = [...new Set(snapshot.lanes.map((item) => item.kind))]
    const notice = snapshot.error ? friendlyAgentWorkError(snapshot.error) : snapshot.notice

    return (
      <article
        key={card.id}
        className={cn(
          'agent-work-card',
          card.tone === 'attention' && 'is-attention',
          card.tone === 'review' && 'is-review',
          card.tone === 'ready' && 'is-ready',
          phase === 'done' && 'is-applied'
        )}
      >
        <button
          type="button"
          className="agent-work-hit"
          onClick={() => setExpandedId((current) => (current === card.id ? null : card.id))}
        >
          <header className="agent-work-head">
            <p className="agent-work-title">
              {agentKindLabel(card.kind)}
              {card.title ? ` · ${card.title}` : ''}
            </p>
            <p className={cn('agent-work-status', `is-${card.tone}`)}>
              {phase === 'done' ? 'Applied to project' : card.statusLabel}
            </p>
          </header>
          {card.summary.length > 0 && (
            <ul className="agent-work-summary">
              {card.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p className="agent-work-detail">{card.detail}</p>
        </button>

        {expanded && (
          <div className="agent-work-body">
            {phase && phase !== 'failed' && phase !== 'done' && (
              <ol className="agent-apply-steps">
                {APPLY_PHASES.map((item) => {
                  const current = applyPhaseIndex(phase)
                  const index = applyPhaseIndex(item.id)
                  const done = current > index
                  const active = current === index
                  return (
                    <li key={item.id} className={cn(done && 'is-done', active && 'is-active')}>
                      {active ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      <span>{item.label}</span>
                      {done ? <span className="agent-apply-check">✓</span> : null}
                    </li>
                  )
                })}
              </ol>
            )}

            {phase === 'done' && <p className="agent-work-applied">Applied to project</p>}

            {phase === 'failed' && (
              <p className="iso-error">{notice ?? 'Could not apply automatically'}</p>
            )}

            {!phase && card.tone === 'working' && (
              <p className="agent-work-copy">This agent is still working.</p>
            )}

            {!phase && card.tone === 'ready' && (
              <>
                {reviewingId === card.id && reviewFiles.length > 0 && (
                  <ul className="agent-work-files">
                    {reviewFiles.map((file) => (
                      <li key={file}>
                        <button type="button" className="agent-work-file" onClick={() => session && openReviewDiff(session, file)}>
                          {file}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="iso-actions">
                  <button type="button" className="iso-btn" onClick={() => void handleReview(card)}>
                    Review
                  </button>
                  <button
                    type="button"
                    className="iso-btn iso-btn-primary"
                    disabled={snapshot.loading}
                    onClick={() => void handleApply(card)}
                  >
                    Apply to Project
                  </button>
                  {session && (
                    <button type="button" className="iso-btn" onClick={() => void cancelReview(projectId, projectRoot)}>
                      Cancel Review
                    </button>
                  )}
                </div>
              </>
            )}

            {!phase && card.tone === 'review' && (
              <>
                {card.overlapPaths.length > 0 && (
                  <ul className="agent-work-files">
                    {card.overlapPaths.slice(0, 8).map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                  </ul>
                )}
                <div className="iso-actions">
                  <button type="button" className="iso-btn" onClick={() => void handleReview(card)}>
                    Review
                  </button>
                  <button
                    type="button"
                    className="iso-btn iso-btn-primary"
                    disabled={snapshot.loading}
                    onClick={() => void handleApply(card)}
                  >
                    Apply to Project
                  </button>
                </div>
              </>
            )}

            {!phase && card.tone === 'attention' && (
              <>
                {card.conflictPaths.length > 0 && (
                  <ul className="agent-work-files">
                    {card.conflictPaths.slice(0, 8).map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                  </ul>
                )}
                {session?.status === 'conflict' ? (
                  <>
                    <p className="agent-work-copy">Bikorch can try to combine both versions.</p>
                    <div className="iso-actions">
                      {otherKinds.map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          className="iso-btn iso-btn-primary"
                          disabled={resolving !== null}
                          onClick={() => void handleResolve(card, kind)}
                        >
                          {resolving === kind ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            `Let ${agentKindLabel(kind)} Resolve`
                          )}
                        </button>
                      ))}
                      <button type="button" className="iso-btn" onClick={() => void handleReview(card)}>
                        Review
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="iso-actions">
                    <button type="button" className="iso-btn" onClick={() => void handleReview(card)}>
                      Review
                    </button>
                    <button
                      type="button"
                      className="iso-btn iso-btn-primary"
                      disabled={snapshot.loading}
                      onClick={() => void handleApply(card)}
                    >
                      Apply to Project
                    </button>
                  </div>
                )}
              </>
            )}

            {card.canResume && (
              <div className="iso-actions">
                <button
                  type="button"
                  className="iso-btn"
                  onClick={() => reopenAgentRun(card.runId, card.kind, card.title)}
                >
                  Resume
                </button>
                <button type="button" className="iso-btn" onClick={() => void handleDiscard(card.runId)}>
                  Discard
                </button>
              </div>
            )}

            <details className="agent-work-advanced">
              <summary>Advanced details</summary>
              <p>
                Branch: {card.branch}
                {card.baseSha ? ` · Base: ${shortSha(card.baseSha)}` : ''}
                {card.targetBranch ? ` · Project branch: ${card.targetBranch}` : ''}
              </p>
            </details>
          </div>
        )}
      </article>
    )
  }

  return (
    <section className="iso-block agent-work">
      <p className="iso-heading">Agent work</p>
      {snapshot.setupError && (
        <div className="agent-work-setup-error">
          <p className="iso-error">Agent workspace setup failed</p>
          <p className="agent-work-copy">{setupFailureDetail(snapshot.setupError)}</p>
          <details>
            <summary>View Details</summary>
            <pre>{snapshot.setupError.output.trim() || 'No extra output.'}</pre>
          </details>
          <div className="iso-actions">
            <button
              type="button"
              className="iso-btn iso-btn-primary"
              disabled={snapshot.loading}
              onClick={() => void retrySetup(projectId, projectRoot)}
            >
              {snapshot.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Retry'}
            </button>
          </div>
        </div>
      )}
      {groups.ready.length > 0 && (
        <div className="iso-section">
          <p className="agent-work-group">
            Ready <span>{groups.ready.length}</span>
          </p>
          {groups.ready.map(renderCard)}
        </div>
      )}
      {groups.working.length > 0 && (
        <div className="iso-section">
          <p className="agent-work-group">
            Working <span>{groups.working.length}</span>
          </p>
          {groups.working.map(renderCard)}
        </div>
      )}
      {groups.review.length > 0 && (
        <div className="iso-section">
          <p className="agent-work-group">
            Review recommended <span>{groups.review.length}</span>
          </p>
          {groups.review.map(renderCard)}
        </div>
      )}
      {groups.attention.length > 0 && (
        <div className="iso-section">
          <p className="agent-work-group">
            Needs attention <span>{groups.attention.length}</span>
          </p>
          {groups.attention.map(renderCard)}
        </div>
      )}

      {snapshot.notice && !snapshot.error && <p className="iso-notice">{snapshot.notice}</p>}
      {snapshot.error && <p className="iso-error">{friendlyAgentWorkError(snapshot.error)}</p>}

      {hasSetup && (
        <details className="agent-work-advanced agent-work-setup">
          <summary>Agent copy setup</summary>
          {localFiles.length > 0 && (
            <>
              <p className="iso-provision-hint">
                Local files stay in the project unless you allow a copy. Tokens in .env / .npmrc are off by default.
              </p>
              <ul className="iso-file-list">
                {localFiles.map((name) => (
                  <li key={name}>
                    <label className="iso-check">
                      <input
                        type="checkbox"
                        checked={snapshot.provision.copyLocalFiles.includes(name)}
                        onChange={(event) => toggleLocalFile(name, event.target.checked)}
                      />
                      <span>{name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="iso-heading">Dependencies</p>
          <div className="iso-radio-list">
            {DEPENDENCY_MODES.map((mode) => (
              <label key={mode.id} className="iso-radio">
                <input
                  type="radio"
                  name={`worktree-deps-${projectId}`}
                  checked={snapshot.provision.dependencyMode === mode.id}
                  onChange={() =>
                    void updateProvision(projectId, projectRoot, {
                      copyLocalFiles: snapshot.provision.copyLocalFiles,
                      dependencyMode: mode.id
                    })
                  }
                />
                <span>
                  <span className="iso-radio-label">{mode.label}</span>
                  <span className="iso-radio-hint">{mode.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
