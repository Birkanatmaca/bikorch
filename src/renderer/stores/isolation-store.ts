import { create } from 'zustand'
import type {
  AgentWorktreeKind,
  IsolationFoldSession,
  IsolationInspectResponse,
  IsolationLaneInput,
  WorktreeProvisionSettings
} from '@shared/contracts/git'
import { AGENT_WORKTREE_KINDS, DEFAULT_WORKTREE_PROVISION, parseWorktreeProvision } from '@shared/contracts/git'
import { useWorkspaceStore } from './workspace-store'
import { evictRecordKeys, keysToKeep } from '@renderer/lib/inactive-cache'
import { resourceLimitsFor, type ResourceProfile } from '@shared/contracts/resources'
import { currentRendererResourceProfile } from '@renderer/lib/resource-limits'
import { friendlyAgentWorkError } from '@renderer/lib/agent-work'

export interface IsolationProjectState extends IsolationInspectResponse {
  loading: boolean
  error: string | null
  notice: string | null
}

interface IsolationStore {
  byProject: Record<string, IsolationProjectState>
  inspect: (projectId: string, projectRoot: string) => Promise<void>
  fold: (projectId: string, projectRoot: string, lane: IsolationLaneInput) => Promise<IsolationFoldSession | null>
  sync: (projectId: string, projectRoot: string) => Promise<IsolationFoldSession | null>
  accept: (projectId: string, projectRoot: string) => Promise<boolean>
  abort: (projectId: string, projectRoot: string) => Promise<void>
  discard: (projectId: string, projectRoot: string, runId: string) => Promise<boolean>
  updateProvision: (
    projectId: string,
    projectRoot: string,
    next: WorktreeProvisionSettings
  ) => Promise<void>
  evictInactive: (activeProjectId: string, profile?: ResourceProfile) => void
}

const EMPTY: IsolationProjectState = {
  lanes: [],
  overlaps: [],
  fold: null,
  queue: [],
  recoveries: [],
  targetBranch: '',
  targetSha: '',
  provision: { ...DEFAULT_WORKTREE_PROVISION },
  availableLocalFiles: [],
  loading: false,
  error: null,
  notice: null
}

const latestInspect = new Map<string, number>()

function collectLanes(projectId: string): IsolationLaneInput[] {
  const workspace = useWorkspaceStore.getState().workspaces[projectId]
  if (!workspace) return []
  const lanes: IsolationLaneInput[] = []
  for (const panel of workspace.panels) {
    if (panel.workspaceIsolation === 'shared') continue
    if (panel.panelRole === 'resolver') continue
    if (!(AGENT_WORKTREE_KINDS as readonly string[]).includes(panel.type)) continue
    if (!panel.worktreePath) continue
    lanes.push({
      panelId: panel.id,
      kind: panel.type as AgentWorktreeKind,
      title: panel.title,
      worktreePath: panel.worktreePath
    })
  }
  return lanes
}

function patch(
  projectId: string,
  update: Partial<IsolationProjectState> | ((current: IsolationProjectState) => IsolationProjectState)
): IsolationProjectState {
  const current = useIsolationStore.getState().byProject[projectId] ?? EMPTY
  return typeof update === 'function' ? update(current) : { ...current, ...update }
}

export const useIsolationStore = create<IsolationStore>((set, get) => ({
  byProject: {},

  inspect: async (projectId, projectRoot) => {
    if (!window.api.git?.inspectIsolation) return
    const token = (latestInspect.get(projectId) ?? 0) + 1
    latestInspect.set(projectId, token)
    const previous = get().byProject[projectId] ?? EMPTY
    if (!previous.lanes.length && !previous.fold && !previous.loading) {
      set((state) => ({
        byProject: {
          ...state.byProject,
          [projectId]: { ...previous, loading: true, error: null }
        }
      }))
    }
    try {
      const snapshot = await window.api.git.inspectIsolation({
        projectRoot,
        lanes: collectLanes(projectId)
      })
      if (latestInspect.get(projectId) !== token) return
      set((state) => ({
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...EMPTY,
            ...snapshot,
            provision: parseWorktreeProvision(snapshot.provision),
            availableLocalFiles: Array.isArray(snapshot.availableLocalFiles)
              ? snapshot.availableLocalFiles
              : [],
            loading: false,
            error: null,
            notice: null
          }
        }
      }))
    } catch (error) {
      if (latestInspect.get(projectId) !== token) return
      set((state) => ({
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...(state.byProject[projectId] ?? EMPTY),
            loading: false,
            error: friendlyAgentWorkError(error instanceof Error ? error.message : 'Could not load agent work')
          }
        }
      }))
    }
  },

  fold: async (projectId, projectRoot, lane) => {
    if (!window.api.git?.foldIsolation) return null
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: patch(projectId, { loading: true, error: null, notice: null })
      }
    }))
    try {
      const session = await window.api.git.foldIsolation({
        projectRoot,
        panelId: lane.panelId,
        kind: lane.kind,
        title: lane.title,
        worktreePath: lane.worktreePath
      })
      if (session.status === 'empty') {
        await get().inspect(projectId, projectRoot)
        set((state) => ({
          byProject: {
            ...state.byProject,
            [projectId]: patch(projectId, {
              loading: false,
              notice: 'Nothing to apply'
            })
          }
        }))
        return session
      }
      set((state) => ({
        byProject: {
          ...state.byProject,
          [projectId]: patch(projectId, (current) => ({
            ...current,
            fold: session,
            loading: false,
            error: null,
            notice: null
          }))
        }
      }))
      await get().inspect(projectId, projectRoot)
      return session
    } catch (error) {
      set((state) => ({
        byProject: {
          ...state.byProject,
          [projectId]: patch(projectId, {
            loading: false,
            error: friendlyAgentWorkError(error instanceof Error ? error.message : 'Could not prepare these changes')
          })
        }
      }))
      return null
    }
  },

  sync: async (projectId, projectRoot) => {
    if (!window.api.git?.syncIsolation) return null
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: patch(projectId, { loading: true, error: null, notice: null })
      }
    }))
    try {
      const session = await window.api.git.syncIsolation({ projectRoot })
      set((state) => ({
        byProject: {
          ...state.byProject,
          [projectId]: patch(projectId, (current) => ({
            ...current,
            fold: session,
            loading: false,
            error: null,
            notice: session.stale ? 'The project changed — review these updates' : null
          }))
        }
      }))
      await get().inspect(projectId, projectRoot)
      return session
    } catch (error) {
      set((state) => ({
        byProject: {
          ...state.byProject,
          [projectId]: patch(projectId, {
            loading: false,
            error: error instanceof Error ? error.message : 'Could not refresh project changes'
          })
        }
      }))
      return null
    }
  },

  accept: async (projectId, projectRoot) => {
    if (!window.api.git?.acceptIsolation) return false
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: patch(projectId, { loading: true, error: null, notice: null })
      }
    }))
    try {
      const result = await window.api.git.acceptIsolation({ projectRoot })
      if (!result.ok) {
        set((state) => ({
          byProject: {
            ...state.byProject,
            [projectId]: patch(projectId, { loading: false, error: friendlyAgentWorkError(result.error) })
          }
        }))
        return false
      }
      await get().inspect(projectId, projectRoot)
      return true
    } catch (error) {
      set((state) => ({
        byProject: {
          ...state.byProject,
          [projectId]: patch(projectId, {
            loading: false,
            error: error instanceof Error ? error.message : 'Could not apply to project'
          })
        }
      }))
      return false
    }
  },

  abort: async (projectId, projectRoot) => {
    if (!window.api.git?.abortIsolation) return
    try {
      await window.api.git.abortIsolation({ projectRoot })
    } finally {
      await get().inspect(projectId, projectRoot)
    }
  },

  updateProvision: async (projectId, projectRoot, next) => {
    if (!window.api.git?.updateWorktreeProvision) return
    const provision = parseWorktreeProvision(next)
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: patch(projectId, { provision, error: null })
      }
    }))
    try {
      const result = await window.api.git.updateWorktreeProvision({
        projectRoot,
        copyLocalFiles: provision.copyLocalFiles,
        dependencyMode: provision.dependencyMode
      })
      set((state) => ({
        byProject: {
          ...state.byProject,
          [projectId]: patch(projectId, {
            provision: parseWorktreeProvision(result.provision),
            availableLocalFiles: result.availableLocalFiles,
            error: null
          })
        }
      }))
    } catch (error) {
      set((state) => ({
        byProject: {
          ...state.byProject,
          [projectId]: patch(projectId, {
            error: error instanceof Error ? error.message : 'Could not save worktree setup'
          })
        }
      }))
    }
  },

  discard: async (projectId, projectRoot, runId) => {
    if (!window.api.git?.discardIsolation) return false
    try {
      const result = await window.api.git.discardIsolation({ projectRoot, runId })
      if (!result.ok) {
        set((state) => ({
          byProject: {
            ...state.byProject,
            [projectId]: patch(projectId, { error: result.error })
          }
        }))
        return false
      }
      await get().inspect(projectId, projectRoot)
      return true
    } catch (error) {
      set((state) => ({
        byProject: {
          ...state.byProject,
          [projectId]: patch(projectId, {
            error: error instanceof Error ? error.message : 'Discard failed'
          })
        }
      }))
      return false
    }
  },

  evictInactive: (activeProjectId, profile) => {
    const limits = resourceLimitsFor(profile ?? currentRendererResourceProfile())
    const keep = keysToKeep(activeProjectId, [activeProjectId], limits.inactiveDiffCacheProjects)
    set((state) => ({
      byProject: evictRecordKeys(state.byProject, keep)
    }))
  }
}))

export function selectIsolationState(
  byProject: Record<string, IsolationProjectState>,
  projectId: string | null
): IsolationProjectState {
  if (!projectId) return EMPTY
  return byProject[projectId] ?? EMPTY
}
