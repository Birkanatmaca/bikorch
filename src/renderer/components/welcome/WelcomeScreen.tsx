import { useMemo } from 'react'
import { ArrowUpRight, Clock, Folder, FolderOpen, FolderPlus } from 'lucide-react'
import { AppLogo, AppWordmark } from '@renderer/components/brand/AppLogo'
import { useOpenProject } from '@renderer/hooks/use-open-project'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

const MAX_RECENT = 8

function ActionCard({
  icon: Icon,
  label,
  hint,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  hint: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="welcome-action-card group">
      <span className="welcome-action-icon">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="welcome-action-text">
        <span className="welcome-action-label">{label}</span>
        <span className="welcome-action-hint">{hint}</span>
      </span>
      <ArrowUpRight className="welcome-action-arrow h-4 w-4" aria-hidden />
    </button>
  )
}

export function WelcomeScreen(): React.JSX.Element {
  const { openFolderPicker, openFolderPath } = useOpenProject()
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

  return (
    <div className="welcome-screen relative flex h-full flex-col items-center justify-center overflow-auto px-6 py-10">
      <div className="welcome-ambient" aria-hidden />
      <div className="relative w-full max-w-xl animate-fade-in">
        <div className="mb-9 flex flex-col items-center text-center">
          <div className="welcome-logo">
            <span className="welcome-logo-halo" aria-hidden />
            <span className="welcome-logo-orbit" aria-hidden />
            <AppLogo size="xl" />
          </div>
          <AppWordmark size="xl" className="mt-6 min-w-[200px]" />
          <p className="welcome-tagline">Multi-CLI workspace orchestrator</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ActionCard
            icon={FolderOpen}
            label="Open project"
            hint="Choose an existing folder"
            onClick={() => void openFolderPicker()}
          />
          <ActionCard
            icon={FolderPlus}
            label="New project"
            hint="Start a fresh workspace"
            onClick={() => void openFolderPicker({ forceNew: true })}
          />
        </div>

        <div className="mt-9">
          <div className="welcome-section-head">
            <Clock className="h-3 w-3" aria-hidden />
            <span>Recent projects</span>
            <span className="welcome-section-rule" aria-hidden />
            {recentProjects.length > 0 && (
              <span className="welcome-section-count">{recentProjects.length}</span>
            )}
          </div>

          <div className="welcome-recent-glass">
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
                  className="welcome-recent-row group"
                >
                  <span className="welcome-recent-glyph">
                    <Folder className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="welcome-recent-name">{project.name}</span>
                  <span className="welcome-recent-path">{project.folderPath}</span>
                  <ArrowUpRight className="welcome-recent-arrow h-3.5 w-3.5" aria-hidden />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
