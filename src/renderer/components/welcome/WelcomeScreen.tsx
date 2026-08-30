import { useMemo } from 'react'
import { Clock, FolderOpen, FolderPlus } from 'lucide-react'
import { AppLogo, AppWordmark } from '@renderer/components/brand/AppLogo'
import { useOpenProject } from '@renderer/hooks/use-open-project'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { cn } from '@renderer/lib/utils'

const MAX_RECENT = 8

function ActionCard({
  icon: Icon,
  label,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-panel-bg px-8 py-6',
        'text-sm text-text-secondary transition-all duration-150',
        'hover:border-primary/40 hover:bg-elevated hover:text-text-primary hover:shadow-lg hover:shadow-primary/5'
      )}
    >
      <Icon className="h-8 w-8 text-text-muted" />
      <span>{label}</span>
    </button>
  )
}

export function WelcomeScreen(): React.JSX.Element {
  const { openFolderPicker, openFolderPath } = useOpenProject()
  const addProject = useWorkspaceStore((s) => s.addProject)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  const projects = useWorkspaceStore((s) => s.projects)

  const recentProjects = useMemo(() => {
    const seen = new Set<string>()
    const items: Array<{ id: string; name: string; folderPath: string }> = []

    for (const project of projects) {
      if (!project.folderPath || seen.has(project.folderPath)) continue
      seen.add(project.folderPath)
      items.push({
        id: project.id,
        name: project.name,
        folderPath: project.folderPath
      })
      if (items.length >= MAX_RECENT) break
    }

    return items
  }, [projects])

  const handleNewProject = (): void => {
    const projectId = addProject()
    setActiveProject(projectId)
    void openFolderPicker()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto px-6 py-10">
      <div className="w-full max-w-2xl animate-fade-in">
        <div className="mb-10 flex flex-col items-center text-center">
          <AppLogo size="xl" />
          <AppWordmark size="xl" className="mt-5 min-w-[200px]" />
          <p className="mt-2 text-sm text-text-muted">AI Developer Workspace</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ActionCard
            icon={FolderOpen}
            label="Open project"
            onClick={() => void openFolderPicker()}
          />
          <ActionCard
            icon={FolderPlus}
            label="New project"
            onClick={handleNewProject}
          />
        </div>

        <div className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-text-muted" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
              Recent projects
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-panel-bg">
            {recentProjects.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-text-secondary">No recent projects yet</p>
                <p className="mt-1 text-xs text-text-muted">
                  Open a folder above — it will appear here for quick access
                </p>
              </div>
            ) : (
              recentProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => openFolderPath(project.folderPath)}
                  className="group flex w-full items-center gap-4 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary group-hover:text-primary">
                    {project.name}
                  </span>
                  <span className="hidden min-w-0 flex-[1.5] truncate font-mono text-xs text-text-muted sm:block">
                    {project.folderPath}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
