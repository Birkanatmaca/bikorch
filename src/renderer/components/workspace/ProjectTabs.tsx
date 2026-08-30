import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { cn, formatProjectName } from '@renderer/lib/utils'
import { Plus, X, FolderOpen } from 'lucide-react'

export function ProjectTabs(): React.JSX.Element {
  const projects = useWorkspaceStore((s) => s.projects)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  const addProject = useWorkspaceStore((s) => s.addProject)
  const removeProject = useWorkspaceStore((s) => s.removeProject)
  const updateProject = useWorkspaceStore((s) => s.updateProject)

  const handleSelectFolder = async (projectId: string): Promise<void> => {
    const folder = await window.api.selectFolder()
    if (folder) {
      updateProject(projectId, {
        folderPath: folder,
        name: formatProjectName(folder, 'Untitled')
      })
    }
  }

  return (
    <div className="flex h-full min-w-0 w-full items-center gap-1 overflow-x-auto">
      {projects.map((project) => {
        const isActive = project.id === activeProjectId
        return (
          <div
            key={project.id}
            className={cn(
              'project-tab group relative flex max-w-[200px] items-center gap-1 rounded-md border px-2 py-0.5 transition-[background-color,border-color,box-shadow,transform] duration-300 app-no-drag',
              isActive
                ? 'project-tab-active border-primary/70 bg-primary/10 text-text-primary'
                : 'border-transparent text-text-secondary hover:border-border hover:bg-hover hover:text-text-primary'
            )}
          >
            {isActive && (
              <>
                <span className="project-tab-ambient" aria-hidden />
                <span className="project-tab-sheen" aria-hidden />
                <span className="project-tab-rail" aria-hidden />
              </>
            )}
            <button
              type="button"
              onClick={() => setActiveProject(project.id)}
              className="relative z-[1] min-w-0 flex-1 truncate text-xs font-medium"
            >
              {project.name}
            </button>
            <button
              type="button"
              onClick={() => void handleSelectFolder(project.id)}
              className={cn(
                'relative z-[1] shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-hover group-hover:opacity-100',
                isActive && 'opacity-60'
              )}
              title="Select project folder"
            >
              <FolderOpen className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => removeProject(project.id)}
              className="relative z-[1] shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-hover hover:text-error group-hover:opacity-100"
              title="Close project"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}

      <button
        type="button"
        onClick={() => addProject()}
        className="app-no-drag flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-text-muted transition-colors hover:border-primary/40 hover:bg-hover hover:text-text-primary"
        title="Add project"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
