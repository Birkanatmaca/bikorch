import { useWorkspaceStore } from '@renderer/stores/workspace-store'

export function useActiveProject(): {
  projectId: string | null
  projectRoot: string | null
  projectName: string | null
} {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const project = useWorkspaceStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId)
  )

  return {
    projectId: activeProjectId,
    projectRoot: project?.folderPath ?? null,
    projectName: project?.name ?? null
  }
}
