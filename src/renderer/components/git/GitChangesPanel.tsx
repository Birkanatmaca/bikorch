import { useEffect, useId, useState } from 'react'
import type { GitChange, GitRepoInfo } from '@shared/contracts/git'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { useEditorStore } from '@renderer/stores/editor-store'
import {
  selectGitBundle,
  selectGitChanges,
  selectGitState,
  useGitStore,
  type GitState
} from '@renderer/stores/git-store'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { cn } from '@renderer/lib/utils'
import { GitBranch, History, Loader2, Minus, Plus, RefreshCw, Save, Undo2 } from 'lucide-react'

const statusColor: Record<GitChange['status'], string> = {
  M: 'text-warning',
  A: 'text-success',
  D: 'text-error',
  U: 'text-info'
}

function setGitError(projectId: string, message: string): void {
  useGitStore.setState((state) => {
    const current = state.stateByProject[projectId]
    if (!current) return state
    return {
      stateByProject: {
        ...state.stateByProject,
        [projectId]: { ...current, error: message }
      }
    }
  })
}

export function GitChangesPanel({
  hideHeader = false
}: {
  hideHeader?: boolean
}): React.JSX.Element {
  const { projectId, projectRoot } = useActiveProject()
  const bundle = useGitStore((s) => selectGitBundle(s.stateByProject, projectId))
  const gitState = useGitStore((s) => selectGitState(s.stateByProject, projectId))
  const refresh = useGitStore((s) => s.refresh)
  const selectRepo = useGitStore((s) => s.selectRepo)
  const checkoutBranch = useGitStore((s) => s.checkoutBranch)
  const discardChange = useGitStore((s) => s.discardChange)
  const stageChange = useGitStore((s) => s.stageChange)
  const unstageChange = useGitStore((s) => s.unstageChange)
  const stageAll = useGitStore((s) => s.stageAll)
  const unstageAll = useGitStore((s) => s.unstageAll)
  const commitChanges = useGitStore((s) => s.commitChanges)
  const openDiff = useEditorStore((s) => s.openDiff)
  const clearDiff = useEditorStore((s) => s.clearDiff)
  const [discardingPath, setDiscardingPath] = useState<string | null>(null)
  const [mutatingPath, setMutatingPath] = useState<string | null>(null)
  const [bulkAction, setBulkAction] = useState<'stage' | 'unstage' | null>(null)
  const [switchingBranch, setSwitchingBranch] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)

  const activeDiff = useEditorStore((s) =>
    projectId ? s.activeDiffByProject[projectId] ?? null : null
  )
  const stagedChanges = gitState.changes.filter((change) => change.staged)
  const unstagedChanges = gitState.changes.filter((change) => !change.staged)

  useEffect(() => {
    if (!projectId || !projectRoot) return
    void refresh(projectId, projectRoot)
  }, [projectId, projectRoot, refresh])

  useEffect(() => {
    setCommitMessage('')
  }, [projectId, bundle.selectedRoot])

  const handleRefresh = (): void => {
    if (projectId && projectRoot) {
      void refresh(projectId, projectRoot)
    }
  }

  const handleOpenDiff = (change: GitChange): void => {
    if (!projectId || !bundle.selectedRoot) return
    void openDiff(projectId, bundle.selectedRoot, change, gitState.changes)
  }

  const handleDiscard = async (change: GitChange): Promise<void> => {
    if (!projectId || !projectRoot || !bundle.selectedRoot || discardingPath) return

    const confirmed = window.confirm(
      change.status === 'U'
        ? `Delete the untracked file "${change.path}"?`
        : `Discard all changes in "${change.path}"? This cannot be undone.`
    )
    if (!confirmed) return

    setDiscardingPath(change.path)
    try {
      await discardChange(projectId, projectRoot, change)
      if (activeDiff?.filePath === change.path) {
        const nextChanges = selectGitChanges(useGitStore.getState().stateByProject, projectId)
        const nextBundle = selectGitBundle(useGitStore.getState().stateByProject, projectId)
        if (nextChanges[0] && nextBundle.selectedRoot) {
          void openDiff(projectId, nextBundle.selectedRoot, nextChanges[0], nextChanges)
        } else {
          clearDiff(projectId)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to discard changes'
      setGitError(projectId, message)
    } finally {
      setDiscardingPath(null)
    }
  }

  const handleStageChange = async (change: GitChange): Promise<void> => {
    if (!projectId || !projectRoot || mutatingPath || bulkAction) return

    setMutatingPath(change.path)
    try {
      if (change.staged) {
        await unstageChange(projectId, projectRoot, change)
      } else {
        await stageChange(projectId, projectRoot, change)
      }
    } catch (error) {
      setGitError(projectId, error instanceof Error ? error.message : 'Failed to update staged changes')
    } finally {
      setMutatingPath(null)
    }
  }

  const handleBulkStage = async (action: 'stage' | 'unstage'): Promise<void> => {
    if (!projectId || !projectRoot || mutatingPath || bulkAction) return

    setBulkAction(action)
    try {
      if (action === 'stage') {
        await stageAll(projectId, projectRoot)
      } else {
        await unstageAll(projectId, projectRoot)
      }
    } catch (error) {
      setGitError(projectId, error instanceof Error ? error.message : 'Failed to update staged changes')
    } finally {
      setBulkAction(null)
    }
  }

  const handleCommit = async (): Promise<void> => {
    if (!projectId || !projectRoot || !commitMessage.trim() || committing) return

    setCommitting(true)
    try {
      await commitChanges(projectId, projectRoot, commitMessage)
      setCommitMessage('')

      const nextBundle = selectGitBundle(useGitStore.getState().stateByProject, projectId)
      const nextChanges = selectGitChanges(useGitStore.getState().stateByProject, projectId)
      const nextChange = activeDiff
        ? nextChanges.find((change) => change.path === activeDiff.filePath)
        : undefined
      if (activeDiff?.mode === 'diff' && nextChange && nextBundle.selectedRoot) {
        void openDiff(projectId, nextBundle.selectedRoot, nextChange, nextChanges)
      } else if (activeDiff?.mode === 'diff') {
        clearDiff(projectId)
      }
    } catch (error) {
      setGitError(projectId, error instanceof Error ? error.message : 'Failed to create commit')
    } finally {
      setCommitting(false)
    }
  }

  const handleBranchChange = async (branch: string): Promise<void> => {
    if (!projectId || !projectRoot || !branch || branch === gitState.branch || switchingBranch) return
    if (
      gitState.changes.length > 0 &&
      !window.confirm('This repository has uncommitted changes. Switch branches anyway?')
    ) {
      return
    }

    setSwitchingBranch(true)
    try {
      await checkoutBranch(projectId, projectRoot, branch)
      const nextBundle = selectGitBundle(useGitStore.getState().stateByProject, projectId)
      const nextChanges = selectGitChanges(useGitStore.getState().stateByProject, projectId)
      const nextChange = activeDiff
        ? nextChanges.find((change) => change.path === activeDiff.filePath)
        : undefined
      if (activeDiff?.mode === 'diff' && nextChange && nextBundle.selectedRoot) {
        void openDiff(projectId, nextBundle.selectedRoot, nextChange, nextChanges)
      } else if (activeDiff?.mode === 'diff') {
        clearDiff(projectId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to switch branch'
      setGitError(projectId, message)
    } finally {
      setSwitchingBranch(false)
    }
  }

  if (!projectRoot) {
    return (
      <EmptyState
        icon={GitBranch}
        title="No project folder"
        description="Select a folder to view git changes"
      />
    )
  }

  const hasRepos = bundle.repos.length > 0
  if (!hasRepos && !bundle.loading) {
    return (
      <div className="flex h-full flex-col">
        {!hideHeader && (
          <PanelHeader branch={null} onRefresh={handleRefresh} loading={bundle.loading} />
        )}
        <EmptyState
          icon={GitBranch}
          title="No git repositories"
          description="Open a folder that is a git repo, or contains repo folders"
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {!hideHeader && (
        <PanelHeader
          branch={gitState.branch}
          onRefresh={handleRefresh}
          loading={bundle.loading}
        />
      )}
      {bundle.repos.length > 1 && (
        <RepoList
          repos={bundle.repos}
          selectedRoot={bundle.selectedRoot}
          byRoot={bundle.byRoot}
          onSelect={(root) => {
            if (projectId) selectRepo(projectId, root)
          }}
        />
      )}

      <div className="flex-1 overflow-auto p-2">
        {bundle.error && (
          <p className="mb-2 rounded-md bg-error/10 px-2 py-1 text-xs text-error">{bundle.error}</p>
        )}

        {gitState.changes.length === 0 && !bundle.loading && (
          <EmptyState
            icon={GitBranch}
            title="No changes"
            description={
              gitState.remoteUrl
                ? `Remote ${gitState.remoteName ?? 'repository'} · working tree is clean`
                : 'Local repository · working tree is clean'
            }
            className="py-8"
          />
        )}

        {gitState.changes.length > 0 && (
          <>
            <ChangeSection
              title="Staged changes"
              count={stagedChanges.length}
              changes={stagedChanges}
              activePath={activeDiff?.filePath ?? null}
              busyPath={mutatingPath}
              discardingPath={discardingPath}
              actionLabel="Unstage"
              actionIcon="unstage"
              onOpenDiff={handleOpenDiff}
              onStage={handleStageChange}
              onDiscard={(change) => void handleDiscard(change)}
            />
            <ChangeSection
              title="Changes"
              count={unstagedChanges.length}
              changes={unstagedChanges}
              activePath={activeDiff?.filePath ?? null}
              busyPath={mutatingPath}
              discardingPath={discardingPath}
              actionLabel="Stage"
              actionIcon="stage"
              onOpenDiff={handleOpenDiff}
              onStage={handleStageChange}
              onDiscard={(change) => void handleDiscard(change)}
            />
          </>
        )}
      </div>
      <RepoSummary
        gitState={gitState}
        loading={bundle.loading}
        switchingBranch={switchingBranch}
        busy={Boolean(mutatingPath || discardingPath)}
        stagedCount={stagedChanges.length}
        commitMessage={commitMessage}
        committing={committing}
        bulkAction={bulkAction}
        onCommitMessageChange={setCommitMessage}
        onCommit={() => void handleCommit()}
        onBulkStage={(action) => void handleBulkStage(action)}
        onBranchChange={(branch) => void handleBranchChange(branch)}
        onRefresh={handleRefresh}
      />
    </div>
  )
}

function ChangeSection({
  title,
  count,
  changes,
  activePath,
  busyPath,
  discardingPath,
  actionLabel,
  actionIcon,
  onOpenDiff,
  onStage,
  onDiscard
}: {
  title: string
  count: number
  changes: GitChange[]
  activePath: string | null
  busyPath: string | null
  discardingPath: string | null
  actionLabel: string
  actionIcon: 'stage' | 'unstage'
  onOpenDiff: (change: GitChange) => void
  onStage: (change: GitChange) => void
  onDiscard: (change: GitChange) => void
}): React.JSX.Element {
  return (
    <section className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between px-1">
        <p className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
          {title} <span className="text-text-secondary">{count}</span>
        </p>
      </div>
      {changes.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/70 px-2 py-2 text-[10px] text-text-muted">
          No files
        </p>
      ) : (
        <div className="space-y-0.5">
          {changes.map((change) => (
            <ChangeRow
              key={change.path}
              change={change}
              active={activePath === change.path}
              busy={Boolean(busyPath || discardingPath)}
              mutating={busyPath === change.path}
              discarding={discardingPath === change.path}
              actionLabel={actionLabel}
              actionIcon={actionIcon}
              onOpenDiff={onOpenDiff}
              onStage={onStage}
              onDiscard={onDiscard}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ChangeRow({
  change,
  active,
  busy,
  mutating,
  discarding,
  actionLabel,
  actionIcon,
  onOpenDiff,
  onStage,
  onDiscard
}: {
  change: GitChange
  active: boolean
  busy: boolean
  mutating: boolean
  discarding: boolean
  actionLabel: string
  actionIcon: 'stage' | 'unstage'
  onOpenDiff: (change: GitChange) => void
  onStage: (change: GitChange) => void
  onDiscard: (change: GitChange) => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors',
        active ? 'bg-primary/10 text-text-primary' : 'text-text-secondary hover:bg-hover'
      )}
    >
      <button
        type="button"
        onClick={() => onOpenDiff(change)}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-xs',
          active ? 'text-text-primary' : 'hover:text-text-primary'
        )}
        title={`Review ${change.path}`}
      >
        <span className={cn('w-4 font-mono font-semibold', statusColor[change.status])}>
          {change.status}
        </span>
        <span className="min-w-0 flex-1 truncate">{change.path}</span>
      </button>
      <button
        type="button"
        onClick={() => onStage(change)}
        disabled={busy}
        title={actionLabel}
        aria-label={`${actionLabel} ${change.path}`}
        className="shrink-0 rounded-md p-1 text-text-muted transition-colors hover:bg-primary/15 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
      >
        {mutating ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : actionIcon === 'stage' ? (
          <Plus className="h-3 w-3" />
        ) : (
          <Minus className="h-3 w-3" />
        )}
      </button>
      <button
        type="button"
        onClick={() => onDiscard(change)}
        disabled={busy}
        title={change.status === 'U' ? 'Delete untracked file' : 'Discard changes'}
        aria-label={`Discard ${change.path}`}
        className="shrink-0 rounded-md p-1 text-text-muted transition-colors hover:bg-error/15 hover:text-error disabled:cursor-not-allowed disabled:opacity-40 group-hover:opacity-100"
      >
        <Undo2 className={cn('h-3 w-3', discarding && 'animate-pulse')} />
      </button>
    </div>
  )
}

function RepoList({
  repos,
  selectedRoot,
  byRoot,
  onSelect
}: {
  repos: GitRepoInfo[]
  selectedRoot: string | null
  byRoot: Record<string, GitState>
  onSelect: (root: string) => void
}): React.JSX.Element {
  return (
    <div className="border-b border-border px-2 py-1.5">
      <p className="mb-1 px-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">
        Repositories
      </p>
      <div className="space-y-0.5">
        {repos.map((repo) => {
          const state = byRoot[repo.root]
          const selected = repo.root === selectedRoot
          const count = state?.changes.length ?? 0
          return (
            <button
              key={repo.root}
              type="button"
              onClick={() => onSelect(repo.root)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors',
                selected
                  ? 'bg-primary/10 text-text-primary'
                  : 'text-text-secondary hover:bg-hover hover:text-text-primary'
              )}
            >
              <GitBranch className="h-3 w-3 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate font-medium">{repo.name}</span>
              <span className="truncate font-mono text-[10px] text-text-muted">
                {state?.branch ?? '—'}
              </span>
              {count > 0 && (
                <span className="font-mono text-[10px] text-warning">{count}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RepoSummary({
  gitState,
  loading,
  switchingBranch,
  busy,
  stagedCount,
  commitMessage,
  committing,
  bulkAction,
  onCommitMessageChange,
  onCommit,
  onBulkStage,
  onBranchChange,
  onRefresh
}: {
  gitState: GitState
  loading: boolean
  switchingBranch: boolean
  busy: boolean
  stagedCount: number
  commitMessage: string
  committing: boolean
  bulkAction: 'stage' | 'unstage' | null
  onCommitMessageChange: (message: string) => void
  onCommit: () => void
  onBulkStage: (action: 'stage' | 'unstage') => void
  onBranchChange: (branch: string) => void
  onRefresh: () => void
}): React.JSX.Element {
  const unstagedCount = Math.max(0, gitState.changes.length - stagedCount)
  const branchSelectId = useId()

  return (
    <div className="shrink-0 border-t border-border bg-panel-bg px-2 py-3">
      <div className="mb-3 border-b border-border/70 pb-3">
        <div className="flex items-center gap-1.5 text-text-muted">
          <Save className="h-3 w-3" />
          <span className="font-mono text-[9px] uppercase tracking-wider">
            Commit staged changes
          </span>
          <span className="font-mono text-[9px] text-primary">{stagedCount}</span>
        </div>
        <div className="mt-2 flex gap-1.5">
          <input
            type="text"
            value={commitMessage}
            onChange={(event) => onCommitMessageChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onCommit()
            }}
            placeholder="Commit message..."
            maxLength={500}
            className="min-w-0 flex-1 rounded-md border border-border bg-app-bg px-2 py-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-primary/60"
          />
          <button
            type="button"
            onClick={onCommit}
            disabled={stagedCount === 0 || !commitMessage.trim() || committing || busy}
            className="shrink-0 rounded-md bg-primary px-2.5 py-1.5 text-[10px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
            title="Commit staged changes"
          >
            {committing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Commit'}
          </button>
        </div>
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => onBulkStage('stage')}
            disabled={loading || busy || bulkAction !== null || unstagedCount === 0}
            className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            title="Stage all changes"
          >
            {bulkAction === 'stage' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            Stage all
          </button>
          <button
            type="button"
            onClick={() => onBulkStage('unstage')}
            disabled={loading || busy || bulkAction !== null || stagedCount === 0}
            className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            title="Unstage all changes"
          >
            {bulkAction === 'unstage' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Minus className="h-3 w-3" />
            )}
            Unstage all
          </button>
        </div>
      </div>
      {gitState.recentCommits.length > 0 && (
        <div className="mb-3 border-b border-border/70 pb-3">
          <div className="flex items-center gap-1.5 text-text-muted">
            <History className="h-3 w-3" />
            <span className="font-mono text-[9px] uppercase tracking-wider">Recent commits</span>
          </div>
          <div className="mt-2 max-h-32 space-y-1.5 overflow-auto pr-1">
            {gitState.recentCommits.map((commit) => (
              <div key={commit.hash} className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span
                    className="min-w-0 flex-1 truncate text-[10px] text-text-secondary"
                    title={commit.subject}
                  >
                    {commit.subject}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-primary">
                    {commit.shortHash}
                  </span>
                </div>
                <p className="truncate font-mono text-[9px] text-text-muted">
                  {commit.author} · {formatCommitDate(commit.date)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <label
              htmlFor={branchSelectId}
              className="font-mono text-[10px] uppercase tracking-wider text-text-muted"
            >
              Branch
            </label>
            <select
              id={branchSelectId}
              value={gitState.branch ?? ''}
              onChange={(event) => onBranchChange(event.target.value)}
              disabled={loading || switchingBranch || gitState.branches.length === 0}
              className="min-w-0 flex-1 rounded border border-border bg-app-bg px-1.5 py-1 font-mono text-[10px] text-text-primary outline-none transition-colors hover:border-primary/60 focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {!gitState.branch && <option value="">Detached HEAD</option>}
              {gitState.branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </div>
          <p
            className="mt-1 truncate font-mono text-[10px] text-text-muted"
            title={gitState.remoteUrl ?? undefined}
          >
            {gitState.remoteUrl ??
              (gitState.remoteName ? gitState.remoteName : 'Local repository · no remote')}
          </p>
          {(gitState.ahead > 0 || gitState.behind > 0) && (
            <p className="mt-1 font-mono text-[10px] text-text-secondary">
              {gitState.ahead > 0 && <span className="text-success">↑{gitState.ahead} ahead</span>}
              {gitState.ahead > 0 && gitState.behind > 0 && (
                <span className="text-text-muted"> · </span>
              )}
              {gitState.behind > 0 && (
                <span className="text-warning">↓{gitState.behind} behind</span>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-md p-1 text-text-muted hover:bg-hover hover:text-text-primary disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        </button>
      </div>
    </div>
  )
}

function formatCommitDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function PanelHeader({
  branch,
  onRefresh,
  loading
}: {
  branch: string | null
  onRefresh: () => void
  loading: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Changes</p>
        {branch && <p className="font-mono text-[10px] text-primary">{branch}</p>}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-hover hover:text-text-primary disabled:opacity-50"
      >
        <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        Refresh
      </button>
    </div>
  )
}
