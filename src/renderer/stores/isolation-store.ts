import { create } from 'zustand'
import type {
  AgentWorktreeKind,
  IsolationFoldSession,
  IsolationInspectResponse,
  IsolationLaneInput
} from '@shared/contracts/git'
import { AGENT_WORKTREE_KINDS } from '@shared/contracts/git'
import { useWorkspaceStore } from './workspace-store'

export interface IsolationProjectState extends IsolationInspectResponse {
  loading: boolean
  error: string | null
  notice: string | null
}

interface IsolationStore {
  byProject: Record<string, IsolationProjectState>
  inspect: (projectId: string, projectRoot: string) => Promise<void>
  fold: (projectId: string, projectRoot: string, lane: IsolationLaneInput) => Promise<IsolationFoldSession | null>
  accept: (projectId: string, projectRoot: string) => Promise<boolean>
  abort: (projectId: string, projectRoot: string) => Promise<void>
}

const EMPTY: IsolationProjectState = {
  lanes: [],
  overlaps: [],
  fold: null,
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
            ...snapshot,
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
            error: error instanceof Error ? error.message : 'Could not inspect agent copies'
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
              notice: 'Nothing to fold'
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
            error: error instanceof Error ? error.message : 'Fold failed'
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
            [projectId]: patch(projectId, { loading: false, error: result.error })
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
            error: error instanceof Error ? error.message : 'Accept failed'
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
  }
}))

export function selectIsolationState(
  byProject: Record<string, IsolationProjectState>,
  projectId: string | null
): IsolationProjectState {
  if (!projectId) return EMPTY
  return byProject[projectId] ?? EMPTY
}
