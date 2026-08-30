import { create } from 'zustand'
import type { GitChange, GitChangeStatus, GitRepoInfo, GitStatusResponse } from '@shared/contracts/git'

export interface GitState {
  branch: string | null
  branches: string[]
  recentCommits: GitStatusResponse['recentCommits']
  isRepo: boolean
  remoteName: string | null
  remoteUrl: string | null
  upstream: string | null
  ahead: number
  behind: number
  changes: GitChange[]
  loading: boolean
  error: string | null
  lastFetchedAt: number | null
}

export interface GitProjectBundle {
  workspaceRoot: string
  repos: GitRepoInfo[]
  selectedRoot: string | null
  byRoot: Record<string, GitState>
  loading: boolean
  error: string | null
}

interface GitStore {
  stateByProject: Record<string, GitProjectBundle>

  refresh: (projectId: string, projectRoot: string, options?: { quiet?: boolean }) => Promise<void>
  selectRepo: (projectId: string, repoRoot: string) => void
  checkoutBranch: (projectId: string, workspaceRoot: string, branch: string) => Promise<void>
  discardChange: (projectId: string, workspaceRoot: string, change: GitChange) => Promise<void>
  getChangeStatus: (projectId: string, filePath: string) => GitChangeStatus | null
}

const EMPTY_CHANGES: GitChange[] = []

export const EMPTY_GIT_STATE: GitState = {
  branch: null,
  branches: [],
  recentCommits: [],
  isRepo: false,
  remoteName: null,
  remoteUrl: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  changes: EMPTY_CHANGES,
  loading: false,
  error: null,
  lastFetchedAt: null
}

export const EMPTY_BUNDLE: GitProjectBundle = {
  workspaceRoot: '',
  repos: [],
  selectedRoot: null,
  byRoot: {},
  loading: false,
  error: null
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  const root = normalizePath(workspaceRoot)
  const target = normalizePath(absolutePath)
  if (target === root) return ''
  if (target.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return target.slice(root.length + 1)
  }
  return target
}

export function findRepoForPath(
  bundle: GitProjectBundle,
  absolutePath: string
): { root: string; relative: string } | null {
  const normalized = normalizePath(absolutePath)
  const repos = [...bundle.repos].sort((a, b) => b.root.length - a.root.length)

  for (const repo of repos) {
    const root = normalizePath(repo.root)
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      return {
        root: repo.root,
        relative: normalized.slice(root.length).replace(/^\//, '')
      }
    }
  }

  return null
}

export function folderHasChanges(bundle: GitProjectBundle, absoluteDir: string): boolean {
  const dir = normalizePath(absoluteDir)

  for (const repo of bundle.repos) {
    const root = normalizePath(repo.root)
    const changes = bundle.byRoot[repo.root]?.changes ?? []
    if (changes.length === 0) continue

    if (dir === root || root.startsWith(`${dir}/`)) {
      return true
    }

    if (dir.startsWith(`${root}/`)) {
      const relDir = dir.slice(root.length + 1)
      if (changes.some((change) => change.path === relDir || change.path.startsWith(`${relDir}/`))) {
        return true
      }
    }
  }

  return false
}

function statusToState(result: GitStatusResponse): GitState {
  return {
    branch: result.branch,
    branches: result.branches,
    recentCommits: result.recentCommits,
    isRepo: result.isRepo,
    remoteName: result.remoteName,
    remoteUrl: result.remoteUrl,
    upstream: result.upstream,
    ahead: result.ahead,
    behind: result.behind,
    changes: result.changes,
    loading: false,
    error: null,
    lastFetchedAt: Date.now()
  }
}

function pickSelectedRoot(repos: GitRepoInfo[], previous: string | null): string | null {
  if (previous && repos.some((repo) => normalizePath(repo.root) === normalizePath(previous))) {
    return previous
  }
  return repos.find((repo) => repo.isWorkspaceRoot)?.root ?? repos[0]?.root ?? null
}

export const useGitStore = create<GitStore>((set, get) => ({
  stateByProject: {},

  refresh: async (projectId, projectRoot, options) => {
    const previous = get().stateByProject[projectId] ?? EMPTY_BUNDLE
    const quiet = Boolean(options?.quiet && previous.selectedRoot)

    set((state) => ({
      stateByProject: {
        ...state.stateByProject,
        [projectId]: {
          ...previous,
          workspaceRoot: projectRoot,
          loading: quiet ? previous.loading : true,
          error: null
        }
      }
    }))

    try {
      const discovered = await window.api.git.discover({ projectRoot })
      const selectedRoot = pickSelectedRoot(discovered.repos, previous.selectedRoot)

      const statuses = await Promise.all(
        discovered.repos.map(async (repo) => {
          const result = await window.api.git.status({ projectRoot: repo.root })
          return [repo.root, statusToState(result)] as const
        })
      )

      const byRoot: Record<string, GitState> = {}
      for (const [root, repoState] of statuses) {
        byRoot[root] = repoState
      }

      set((state) => ({
        stateByProject: {
          ...state.stateByProject,
          [projectId]: {
            workspaceRoot: projectRoot,
            repos: discovered.repos,
            selectedRoot,
            byRoot,
            loading: false,
            error: null
          }
        }
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load git status'
      set((state) => ({
        stateByProject: {
          ...state.stateByProject,
          [projectId]: {
            ...(state.stateByProject[projectId] ?? EMPTY_BUNDLE),
            loading: false,
            error: message
          }
        }
      }))
    }
  },

  discardChange: async (projectId, workspaceRoot, change) => {
    const bundle = get().stateByProject[projectId]
    const repoRoot = bundle?.selectedRoot
    if (!repoRoot) {
      throw new Error('No repository selected')
    }

    await window.api.git.discard({
      projectRoot: repoRoot,
      filePath: change.path,
      status: change.status
    })
    await get().refresh(projectId, workspaceRoot)
  },

  checkoutBranch: async (projectId, workspaceRoot, branch) => {
    const bundle = get().stateByProject[projectId]
    const repoRoot = bundle?.selectedRoot
    if (!repoRoot) {
      throw new Error('No repository selected')
    }

    await window.api.git.checkoutBranch({ projectRoot: repoRoot, branch })
    await get().refresh(projectId, workspaceRoot)
  },

  selectRepo: (projectId, repoRoot) => {
    const bundle = get().stateByProject[projectId]
    if (!bundle) return
    if (!bundle.repos.some((repo) => normalizePath(repo.root) === normalizePath(repoRoot))) {
      return
    }
    set((state) => ({
      stateByProject: {
        ...state.stateByProject,
        [projectId]: {
          ...bundle,
          selectedRoot: repoRoot
        }
      }
    }))
  },

  getChangeStatus: (projectId, filePath) => {
    const bundle = get().stateByProject[projectId]
    if (!bundle) return null

    const normalized = normalizePath(filePath)
    const repos = [...bundle.repos].sort((a, b) => b.root.length - a.root.length)

    for (const repo of repos) {
      const repoRoot = normalizePath(repo.root)
      const matches =
        normalized === repoRoot ||
        normalized.startsWith(`${repoRoot}/`) ||
        normalized.startsWith(`${repo.name}/`) ||
        !normalized.includes('/')

      if (normalized === repoRoot || normalized.startsWith(`${repoRoot}/`)) {
        const relative = normalized.slice(repoRoot.length).replace(/^\//, '')
        const change = bundle.byRoot[repo.root]?.changes.find(
          (item) => normalizePath(item.path) === relative
        )
        return change?.status ?? null
      }

      if (normalized.startsWith(`${repo.name}/`)) {
        const relative = normalized.slice(repo.name.length + 1)
        const change = bundle.byRoot[repo.root]?.changes.find(
          (item) => normalizePath(item.path) === relative
        )
        return change?.status ?? null
      }

      if (!matches) continue
    }

    const selected = bundle.selectedRoot
      ? bundle.byRoot[bundle.selectedRoot]
      : null
    const change = selected?.changes.find((item) => normalizePath(item.path) === normalized)
    return change?.status ?? null
  }
}))

export function selectGitBundle(
  stateByProject: Record<string, GitProjectBundle>,
  projectId: string | null
): GitProjectBundle {
  if (!projectId) return EMPTY_BUNDLE
  return stateByProject[projectId] ?? EMPTY_BUNDLE
}

export function selectGitState(
  stateByProject: Record<string, GitProjectBundle>,
  projectId: string | null
): GitState {
  const bundle = selectGitBundle(stateByProject, projectId)
  if (!bundle.selectedRoot) return EMPTY_GIT_STATE
  return bundle.byRoot[bundle.selectedRoot] ?? EMPTY_GIT_STATE
}

export function selectGitChanges(
  stateByProject: Record<string, GitProjectBundle>,
  projectId: string | null
): GitChange[] {
  return selectGitState(stateByProject, projectId).changes
}

export function resolveFileChange(
  stateByProject: Record<string, GitProjectBundle>,
  projectId: string | null,
  absolutePath: string
): { repoRoot: string; change: GitChange } | null {
  if (!projectId) return null
  const bundle = selectGitBundle(stateByProject, projectId)
  const normalized = normalizePath(absolutePath)
  const repos = [...bundle.repos].sort((a, b) => b.root.length - a.root.length)

  for (const repo of repos) {
    const repoRoot = normalizePath(repo.root)
    if (normalized !== repoRoot && !normalized.startsWith(`${repoRoot}/`)) continue

    const relative = normalized.slice(repoRoot.length).replace(/^\//, '')
    const change = bundle.byRoot[repo.root]?.changes.find(
      (item) => normalizePath(item.path) === relative
    )
    if (change) return { repoRoot: repo.root, change }
    return null
  }

  return null
}

export function pathHasGitChanges(
  stateByProject: Record<string, GitProjectBundle>,
  projectId: string | null,
  absolutePath: string,
  isDirectory: boolean
): GitChangeStatus | null {
  if (!projectId) return null
  const bundle = selectGitBundle(stateByProject, projectId)
  const normalized = normalizePath(absolutePath)
  const repos = [...bundle.repos].sort((a, b) => b.root.length - a.root.length)

  for (const repo of repos) {
    const repoRoot = normalizePath(repo.root)
    const inRepo =
      normalized === repoRoot ||
      normalized.startsWith(`${repoRoot}/`) ||
      (isDirectory && repoRoot.startsWith(`${normalized}/`))
    if (!inRepo) continue

    const changes = bundle.byRoot[repo.root]?.changes ?? []
    if (!isDirectory) {
      const relative = normalized.slice(repoRoot.length).replace(/^\//, '')
      return changes.find((item) => normalizePath(item.path) === relative)?.status ?? null
    }

    const prefix =
      normalized === repoRoot ? '' : `${normalized.slice(repoRoot.length).replace(/^\//, '')}/`
    const hit = changes.find((item) => {
      const path = normalizePath(item.path)
      return prefix === '' ? true : path.startsWith(prefix) || path === prefix.slice(0, -1)
    })
    return hit?.status ?? null
  }

  return null
}

export function useGitStatusBar(projectId: string | null): {
  branch: string | null
  isRepo: boolean
  remoteName: string | null
  ahead: number
  behind: number
  changesCount: number
  repoCount: number
  selectedName: string | null
} {
  const bundle = useGitStore((s) => (projectId ? s.stateByProject[projectId] : undefined))
  const selected = bundle?.selectedRoot ? bundle.byRoot[bundle.selectedRoot] : undefined
  const selectedRepo = bundle?.repos.find((repo) => repo.root === bundle.selectedRoot)

  let changesCount = 0
  if (bundle) {
    for (const state of Object.values(bundle.byRoot)) {
      changesCount += state.changes.length
    }
  }

  return {
    branch: selected?.branch ?? null,
    isRepo: (bundle?.repos.length ?? 0) > 0,
    remoteName: selected?.remoteName ?? null,
    ahead: selected?.ahead ?? 0,
    behind: selected?.behind ?? 0,
    changesCount,
    repoCount: bundle?.repos.length ?? 0,
    selectedName: selectedRepo?.name ?? null
  }
}
