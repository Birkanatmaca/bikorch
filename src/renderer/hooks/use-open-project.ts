import { useCallback } from 'react'
import { formatProjectName } from '@renderer/lib/utils'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

export function useOpenProject(): {
  openFolderPicker: () => Promise<string | null>
  openFolderPath: (folderPath: string) => string
} {
  const addProject = useWorkspaceStore((s) => s.addProject)
  const updateProject = useWorkspaceStore((s) => s.updateProject)
  const touchRecentProject = useWorkspaceStore((s) => s.touchRecentProject)
  const ensureProjectWorkspace = useWorkspaceStore((s) => s.ensureProjectWorkspace)

  const openFolderPath = useCallback(
    (folderPath: string): string => {
      const state = useWorkspaceStore.getState()
      const name = formatProjectName(folderPath, 'Untitled')

      const existing = state.projects.find((p) => p.folderPath === folderPath)
      if (existing) {
        touchRecentProject(existing.id)
        ensureProjectWorkspace(existing.id, true)
        return existing.id
      }

      const active = state.projects.find((p) => p.id === state.activeProjectId)
      if (active && !active.folderPath) {
        updateProject(active.id, { folderPath, name })
        touchRecentProject(active.id)
        ensureProjectWorkspace(active.id, true)
        return active.id
      }

      const projectId = addProject(name, folderPath)
      ensureProjectWorkspace(projectId, true)
      touchRecentProject(projectId)
      return projectId
    },
    [addProject, ensureProjectWorkspace, touchRecentProject, updateProject]
  )

  const openFolderPicker = useCallback(async (): Promise<string | null> => {
    const folder = await window.api.selectFolder()
    if (!folder) return null
    return openFolderPath(folder)
  }, [openFolderPath])

  return { openFolderPicker, openFolderPath }
}
