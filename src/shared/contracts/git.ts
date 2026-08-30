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

export const GIT_IPC = {
  DISCOVER: 'git:discover',
  STATUS: 'git:status',
  DIFF: 'git:diff',
  DISCARD: 'git:discard',
  CHECKOUT_BRANCH: 'git:checkout-branch'
} as const

export const GIT_STATUS_LABELS: Record<GitChangeStatus, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  U: 'Untracked'
}
