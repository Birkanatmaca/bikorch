export type GitChangeStatus = 'M' | 'A' | 'D' | 'U'

export interface GitChange {
  path: string
  status: GitChangeStatus
  staged: boolean
}

export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
}

export interface GitRepoInfo {
  name: string
  root: string
  isWorkspaceRoot: boolean
}

export interface GitDiscoverRequest {
  projectRoot: string
}

export interface GitDiscoverResponse {
  repos: GitRepoInfo[]
}

export interface GitStatusRequest {
  projectRoot: string
}

export interface GitCheckoutBranchRequest {
  projectRoot: string
  branch: string
}

export interface GitStatusResponse {
  changes: GitChange[]
  branch: string | null
  branches: string[]
  recentCommits: GitCommit[]
  isRepo: boolean
  remoteName: string | null
  remoteUrl: string | null
  upstream: string | null
  ahead: number
  behind: number
}

export interface GitDiffRequest {
  projectRoot: string
  filePath: string
  status: GitChangeStatus
}

export interface GitDiffResponse {
  original: string
  modified: string
  filePath: string
  language: string
}

export interface GitDiscardRequest {
  projectRoot: string
  filePath: string
  status: GitChangeStatus
}

export interface GitFileRequest {
  projectRoot: string
  filePath: string
}

export interface GitCommitRequest {
  projectRoot: string
  message: string
}

export const AGENT_WORKTREE_KINDS = ['claude', 'cursor', 'gemini', 'antigravity', 'codex'] as const
export type AgentWorktreeKind = (typeof AGENT_WORKTREE_KINDS)[number]

export interface GitEnsureWorktreeRequest {
  projectRoot: string
  panelId: string
  kind: AgentWorktreeKind
  title?: string
}

export interface GitEnsureWorktreeResponse {
  ok: boolean
  worktreePath?: string
  branch?: string
  runId?: string
  targetBranch?: string
  baseSha?: string
  error?: string
}

export interface GitRemoveWorktreeRequest {
  projectRoot: string
  worktreePath: string
  title?: string
  /** park = checkpoint and keep the worktree. remove = checkpoint, drop the folder, keep the branch. */
  mode?: 'park' | 'remove'
}

export interface GitSessionSnapshotRequest {
  cwd: string
  sinceSha?: string
}

export interface GitSessionSnapshot {
  headSha: string | null
  changedFiles: string[]
  commits: Array<{ shortHash: string; subject: string }>
}

export type WorkspaceIsolation = 'isolated' | 'shared'
export type IsolationActiveState = 'ready' | 'parked' | 'missing' | 'inactive'
export type AgentRunStatus =
  | 'active'
  | 'parked'
  | 'queued'
  | 'integrating'
  | 'conflict'
  | 'accepted'
  | 'abandoned'

export interface AgentRunRecord {
  id: string
  kind: AgentWorktreeKind
  title: string
  branch: string
  worktreePath: string
  targetBranch: string
  baseSha: string
  isolationPolicy: WorkspaceIsolation
  status: AgentRunStatus
  attachedPanelId: string | null
  createdAt: number
  updatedAt: number
}

export interface IsolationLaneInput {
  panelId: string
  kind: AgentWorktreeKind
  title: string
  worktreePath: string
}

export interface IsolationLane {
  panelId: string
  runId: string
  kind: AgentWorktreeKind
  title: string
  worktreePath: string
  branch: string
  files: string[]
  targetBranch: string
  baseSha: string
  isolationPolicy: WorkspaceIsolation
  isolationState: IsolationActiveState
  attached: boolean
}

export type MergeQueueStatus = 'pending' | 'integrating' | 'conflict' | 'review' | 'stale'

export interface MergeQueueItem {
  runId: string
  panelId: string
  kind: AgentWorktreeKind
  title: string
  status: MergeQueueStatus
  fileCount: number
}

export interface IsolationOverlap {
  path: string
  panelIds: string[]
  labels: string[]
}

export interface IsolationConflictFile {
  path: string
  absolutePath: string
  hunks?: string
  base?: string
  main?: string
  agent?: string
}

export interface IsolationFoldSession {
  id: string
  runId: string
  panelId: string
  kind: AgentWorktreeKind
  title: string
  branch: string
  agentWorktreePath: string
  integrationPath?: string
  integrationBranch?: string
  targetBranch: string
  baseSha: string
  targetSha: string
  stale: boolean
  status: 'empty' | 'clean' | 'conflict'
  files: string[]
  conflicts: IsolationConflictFile[]
}

export interface IsolationInspectRequest {
  projectRoot: string
  lanes: IsolationLaneInput[]
  /** Test-only override; the renderer never sends this. */
  baseDir?: string
}

export interface IsolationInspectResponse {
  lanes: IsolationLane[]
  overlaps: IsolationOverlap[]
  fold: IsolationFoldSession | null
  queue: MergeQueueItem[]
  targetBranch: string
  targetSha: string
}

export interface IsolationFoldRequest {
  projectRoot: string
  panelId: string
  kind: AgentWorktreeKind
  title: string
  worktreePath: string
}

export interface IsolationProjectRequest {
  projectRoot: string
}

export interface IsolationDiffRequest {
  projectRoot: string
  filePath: string
}

export const GIT_IPC = {
  DISCOVER: 'git:discover',
  STATUS: 'git:status',
  DIFF: 'git:diff',
  DISCARD: 'git:discard',
  CHECKOUT_BRANCH: 'git:checkout-branch',
  STAGE: 'git:stage',
  UNSTAGE: 'git:unstage',
  STAGE_ALL: 'git:stage-all',
  UNSTAGE_ALL: 'git:unstage-all',
  COMMIT: 'git:commit',
  ENSURE_WORKTREE: 'git:ensure-worktree',
  REMOVE_WORKTREE: 'git:remove-worktree',
  SESSION_SNAPSHOT: 'git:session-snapshot',
  ISOLATION_INSPECT: 'git:isolation-inspect',
  ISOLATION_FOLD: 'git:isolation-fold',
  ISOLATION_SYNC: 'git:isolation-sync',
  ISOLATION_ACCEPT: 'git:isolation-accept',
  ISOLATION_ABORT: 'git:isolation-abort',
  ISOLATION_DIFF: 'git:isolation-diff'
} as const

export const GIT_STATUS_LABELS: Record<GitChangeStatus, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  U: 'Untracked'
}
