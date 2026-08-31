import { create } from 'zustand'
import type { GitChange, GitChangeStatus, GitDiffResponse } from '@shared/contracts/git'
import { detectLanguage } from '@renderer/lib/file-icons'
import {
  resolveFileChange,
  selectGitChanges,
  useGitStore
} from './git-store'
import { useWorkspaceStore } from './workspace-store'

export type ReviewMode = 'diff' | 'file'

interface ActiveDiff {
  filePath: string
  status: GitChangeStatus | null
  index: number
  mode: ReviewMode
  absolutePath?: string
}

interface EditorStore {
  selectedFileByProject: Record<string, string | null>
  activeDiffByProject: Record<string, ActiveDiff | null>
  diffContentByProject: Record<string, GitDiffResponse | null>
  diffLoadingByProject: Record<string, boolean>
  diffErrorByProject: Record<string, string | null>

  hydrate: (
    state: {
      selectedFileByProject: Record<string, string | null>
      activeDiffByProject: Record<
        string,
        {
          filePath: string
          status: GitChangeStatus | null
          index: number
          mode?: ReviewMode
          absolutePath?: string
        } | null
      >
    }
  ) => void
  getPersistedState: () => Pick<EditorStore, 'selectedFileByProject' | 'activeDiffByProject'>

  setSelectedFile: (projectId: string, filePath: string | null) => void
  openDiff: (
    projectId: string,
    projectRoot: string,
    change: GitChange,
    changes: GitChange[]
  ) => Promise<void>
  openFile: (projectId: string, workspaceRoot: string, absolutePath: string) => Promise<void>
  navigateDiff: (projectId: string, projectRoot: string, direction: 'prev' | 'next') => Promise<void>
  refreshDiff: (projectId: string, projectRoot: string) => Promise<void>
  ensureDiffPanel: () => void
  clearDiff: (projectId: string) => void
}

function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const path = absolutePath.replace(/\\/g, '/')
  if (path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return path.slice(root.length + 1)
  }
  if (path.toLowerCase() === root.toLowerCase()) return ''
  return path
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  selectedFileByProject: {},
  activeDiffByProject: {},
  diffContentByProject: {},
  diffLoadingByProject: {},
  diffErrorByProject: {},

  hydrate: (state) => {
    const normalizedActive: Record<string, ActiveDiff | null> = {}
    for (const [projectId, active] of Object.entries(state.activeDiffByProject ?? {})) {
      if (!active) {
        normalizedActive[projectId] = null
        continue
      }
      normalizedActive[projectId] = {
        filePath: active.filePath,
        status: active.status,
        index: active.index,
        mode: active.mode ?? (active.status ? 'diff' : 'file'),
        absolutePath: active.absolutePath
      }
    }

    set({
      selectedFileByProject: state.selectedFileByProject,
      activeDiffByProject: normalizedActive,
      diffContentByProject: {},
      diffLoadingByProject: {},
      diffErrorByProject: {}
    })
  },

  getPersistedState: () => {
    const { selectedFileByProject, activeDiffByProject } = get()
    return { selectedFileByProject, activeDiffByProject }
  },

  setSelectedFile: (projectId, filePath) => {
    set((state) => ({
      selectedFileByProject: { ...state.selectedFileByProject, [projectId]: filePath }
    }))
  },

  ensureDiffPanel: () => {
    const workspace = useWorkspaceStore.getState()
    const activeProjectId = workspace.activeProjectId
    if (!activeProjectId) return

    const panels = workspace.workspaces[activeProjectId]?.panels ?? []
    const existing = panels.find((p) => p.type === 'diff')
    if (!existing) {
      workspace.addPanel('diff', 'right')
      return
    }
    if (existing.zone !== 'right') {
      workspace.movePanel(existing.id, 'right')
    }
  },

  openDiff: async (projectId, projectRoot, change, changes) => {
    const index = changes.findIndex((c) => c.path === change.path)

    get().ensureDiffPanel()

    const previous = get().activeDiffByProject[projectId]
    const sameFile =
      previous?.mode === 'diff' &&
      previous.filePath === change.path &&
      previous.status === change.status

    set((state) => ({
      activeDiffByProject: {
        ...state.activeDiffByProject,
        [projectId]: {
          filePath: change.path,
          status: change.status,
          index: Math.max(index, 0),
          mode: 'diff'
        }
      },
      diffContentByProject: sameFile
        ? state.diffContentByProject
        : { ...state.diffContentByProject, [projectId]: null },
      diffLoadingByProject: { ...state.diffLoadingByProject, [projectId]: true },
      diffErrorByProject: { ...state.diffErrorByProject, [projectId]: null },
      selectedFileByProject: { ...state.selectedFileByProject, [projectId]: change.path }
    }))

    try {
      const diff = await window.api.git.diff({
        projectRoot,
        filePath: change.path,
        status: change.status
      })

      set((state) => ({
        diffContentByProject: { ...state.diffContentByProject, [projectId]: diff },
        diffLoadingByProject: { ...state.diffLoadingByProject, [projectId]: false }
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load diff'
      set((state) => ({
        diffLoadingByProject: { ...state.diffLoadingByProject, [projectId]: false },
        diffErrorByProject: { ...state.diffErrorByProject, [projectId]: message }
      }))
    }
  },

  openFile: async (projectId, workspaceRoot, absolutePath) => {
    const relative = toWorkspaceRelative(workspaceRoot, absolutePath)
    const matched = resolveFileChange(
      useGitStore.getState().stateByProject,
      projectId,
      absolutePath
    )

    if (matched) {
      useGitStore.getState().selectRepo(projectId, matched.repoRoot)
      const repoChanges =
        useGitStore.getState().stateByProject[projectId]?.byRoot[matched.repoRoot]?.changes ?? []
      await get().openDiff(projectId, matched.repoRoot, matched.change, repoChanges)
      set((state) => ({
        selectedFileByProject: {
          ...state.selectedFileByProject,
          [projectId]: relative || matched.change.path
        },
        activeDiffByProject: {
          ...state.activeDiffByProject,
          [projectId]: state.activeDiffByProject[projectId]
            ? {
                ...state.activeDiffByProject[projectId]!,
                absolutePath
              }
            : null
        }
      }))
      return
    }

    get().ensureDiffPanel()

    const previous = get().activeDiffByProject[projectId]
    const sameFile =
      previous?.mode === 'file' &&
      (previous.absolutePath === absolutePath || previous.filePath === relative)

    set((state) => ({
      activeDiffByProject: {
        ...state.activeDiffByProject,
        [projectId]: {
          filePath: relative || absolutePath,
          status: null,
          index: 0,
          mode: 'file',
          absolutePath
        }
      },
      diffContentByProject: sameFile
        ? state.diffContentByProject
        : { ...state.diffContentByProject, [projectId]: null },
      diffLoadingByProject: { ...state.diffLoadingByProject, [projectId]: true },
      diffErrorByProject: { ...state.diffErrorByProject, [projectId]: null },
      selectedFileByProject: { ...state.selectedFileByProject, [projectId]: relative || absolutePath }
    }))

    try {
      const result = await window.api.fs.readFile({
        projectRoot: workspaceRoot,
        filePath: absolutePath
      })

      set((state) => ({
        diffContentByProject: {
          ...state.diffContentByProject,
          [projectId]: {
            original: result.content,
            modified: result.content,
            filePath: relative || result.path,
            language: detectLanguage(relative || result.path)
          }
        },
        diffLoadingByProject: { ...state.diffLoadingByProject, [projectId]: false }
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open file'
      set((state) => ({
        diffLoadingByProject: { ...state.diffLoadingByProject, [projectId]: false },
        diffErrorByProject: { ...state.diffErrorByProject, [projectId]: message }
      }))
    }
  },

  navigateDiff: async (projectId, projectRoot, direction) => {
    const activeDiff = get().activeDiffByProject[projectId]
    if (!activeDiff || activeDiff.mode !== 'diff') return

    const gitChanges = selectGitChanges(useGitStore.getState().stateByProject, projectId)
    if (gitChanges.length === 0) return

    const nextIndex =
      direction === 'next'
        ? (activeDiff.index + 1) % gitChanges.length
        : (activeDiff.index - 1 + gitChanges.length) % gitChanges.length

    const nextChange = gitChanges[nextIndex]
    if (!nextChange) return

    await get().openDiff(projectId, projectRoot, nextChange, gitChanges)
  },

  refreshDiff: async (projectId, projectRoot) => {
    const activeDiff = get().activeDiffByProject[projectId]
    if (!activeDiff) return

    if (activeDiff.mode === 'file') {
      const absolutePath = activeDiff.absolutePath
      const workspace = useWorkspaceStore.getState()
      const folder =
        workspace.projects.find((p) => p.id === projectId)?.folderPath ?? projectRoot
      if (!absolutePath || !folder) return
      await get().openFile(projectId, folder, absolutePath)
      return
    }

    const gitChanges = selectGitChanges(useGitStore.getState().stateByProject, projectId)
    if (!activeDiff.status) return

    const change = gitChanges.find((c) => c.path === activeDiff.filePath)
    if (!change) {
      get().clearDiff(projectId)
      return
    }

    await get().openDiff(projectId, projectRoot, change, gitChanges)
  },

  clearDiff: (projectId) => {
    set((state) => ({
      activeDiffByProject: { ...state.activeDiffByProject, [projectId]: null },
      diffContentByProject: { ...state.diffContentByProject, [projectId]: null },
      diffLoadingByProject: { ...state.diffLoadingByProject, [projectId]: false },
      diffErrorByProject: { ...state.diffErrorByProject, [projectId]: null }
    }))
  }
}))
