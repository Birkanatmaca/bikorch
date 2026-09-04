import { useCallback } from 'react'
import { formatProjectName } from '@renderer/lib/utils'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

interface OpenFolderOptions {
  /** Always add a new tab unless this folder is already open. */
  forceNew?: boolean
}

export function useOpenProject(): {
  openFolderPicker: (options?: OpenFolderOptions) => Promise<string | null>
  openFolderPath: (folderPath: string, options?: OpenFolderOptions) => string
} {
  const addProject = useWorkspaceStore((s) => s.addProject)
  const updateProject = useWorkspaceStore((s) => s.updateProject)
  const touchRecentProject = useWorkspaceStore((s) => s.touchRecentProject)
  const ensureProjectWorkspace = useWorkspaceStore((s) => s.ensureProjectWorkspace)

  const openFolderPath = useCallback(
    (folderPath: string, options?: OpenFolderOptions): string => {
      const state = useWorkspaceStore.getState()
      const name = formatProjectName(folderPath, 'Untitled')

      const existing = state.projects.find((p) => p.folderPath === folderPath)
      if (existing) {
        touchRecentProject(existing.id)
        ensureProjectWorkspace(existing.id, true)
        return existing.id
      }

      if (!options?.forceNew) {
        const active = state.projects.find((p) => p.id === state.activeProjectId)
        if (active && !active.folderPath) {
          updateProject(active.id, { folderPath, name })
          touchRecentProject(active.id)
          ensureProjectWorkspace(active.id, true)
          return active.id
        }
      }

      const projectId = addProject(name, folderPath)
      ensureProjectWorkspace(projectId, true)
      touchRecentProject(projectId)
      return projectId
    },
    [addProject, ensureProjectWorkspace, touchRecentProject, updateProject]
  )

  const openFolderPicker = useCallback(
    async (options?: OpenFolderOptions): Promise<string | null> => {
      const folder = await window.api.selectFolder()
      if (!folder) return null
      return openFolderPath(folder, options)
    },
    [openFolderPath]
  )

  return { openFolderPicker, openFolderPath }
}
