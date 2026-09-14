import { useRef } from 'react'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useActivityAttentionStore } from '@renderer/stores/activity-attention-store'
import { useOpenProject } from '@renderer/hooks/use-open-project'
import { summarizeProjectTabActivity, type ProjectTabActivity } from '@renderer/lib/project-activity'
import { focusWorkspacePanel } from '@renderer/lib/app-events'
import { cn, formatProjectName } from '@renderer/lib/utils'
import { FolderOpen, Plus, X } from 'lucide-react'
import type { Project } from '@shared/types'

function TabFace({
  project,
  isActive,
  activity
}: {
  project: Project
  isActive: boolean
  activity: ProjectTabActivity
}): React.JSX.Element {
  return (
    <>
      <span
        className={cn(
          'project-tab-dot',
          isActive && activity.signal === 'idle' && 'is-on',
          activity.signal === 'busy' && 'is-busy',
          activity.signal === 'ready' && 'is-ready',
          activity.signal === 'error' && 'is-error'
        )}
        aria-hidden
      />
      <span className="project-tab-name">{project.name}</span>
    </>
  )
}

export function ProjectTabs(): React.JSX.Element {
  const projects = useWorkspaceStore((s) => s.projects)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  const removeProject = useWorkspaceStore((s) => s.removeProject)
  const updateProject = useWorkspaceStore((s) => s.updateProject)
  const sessions = useTerminalStore((s) => s.sessions)
  const attentionByProject = useActivityAttentionStore((s) => s.attentionByProject)
  const { openFolderPicker } = useOpenProject()
  const listRef = useRef<HTMLDivElement>(null)

  const activityFor = (projectId: string): ProjectTabActivity =>
    summarizeProjectTabActivity({
      panels: workspaces[projectId]?.panels ?? [],
      sessions,
      attention: attentionByProject[projectId] ?? []
    })

  const activateProject = (projectId: string): void => {
    const attentionStore = useActivityAttentionStore.getState()
    const pending = attentionStore.attentionByProject[projectId]
    const review = pending?.reduce((latest, item) => (item.at >= latest.at ? item : latest), pending[0])
    setActiveProject(projectId)
    attentionStore.clearProject(projectId)
    if (!review) return
    window.setTimeout(() => focusWorkspacePanel(review.panelId), 40)
  }

  const handleSelectFolder = async (projectId: string): Promise<void> => {
    const folder = await window.api.selectFolder()
    if (folder) {
      updateProject(projectId, {
        folderPath: folder,
        name: formatProjectName(folder, 'Untitled')
      })
    }
  }

  const handleActivate = (event: React.PointerEvent<HTMLDivElement>, projectId: string): void => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('[data-tab-action]')) return
    event.stopPropagation()
    activateProject(projectId)
  }

  return (
    <div
      ref={listRef}
      className="project-tabs relative flex h-full min-w-0 w-full items-center overflow-x-auto"
      role="tablist"
      aria-label="Open projects"
    >
      {projects.map((project) => {
        const isActive = project.id === activeProjectId
        const activity = activityFor(project.id)
        const tabTitle = [project.folderPath || project.name, activity.label].filter(Boolean).join(' · ')

        return (
          <div
            key={project.id}
            data-project-id={project.id}
            onPointerDown={(event) => handleActivate(event, project.id)}
            role="tab"
            aria-selected={isActive}
            aria-label={activity.label ? `${project.name}. ${activity.label}` : project.name}
            title={tabTitle}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                activateProject(project.id)
              }
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const index = projects.findIndex((item) => item.id === project.id)
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? projects.length - 1
                      : (index + (event.key === 'ArrowRight' ? 1 : -1) + projects.length) %
                        projects.length
                activateProject(projects[next].id)
                const tabs = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')
                tabs?.[next]?.focus()
              }
            }}
            className={cn(
              'project-tab group relative flex max-w-[196px] items-center gap-1.5 app-no-drag',
              isActive ? 'is-active' : 'is-idle',
              activity.signal === 'busy' && 'is-working',
              activity.signal === 'ready' && 'is-ready',
              activity.signal === 'error' && 'is-alert'
            )}
          >
            <TabFace project={project} isActive={isActive} activity={activity} />
            <button
              type="button"
              data-tab-action="folder"
              onClick={() => void handleSelectFolder(project.id)}
              className="project-tab-action"
              title="Select project folder"
              aria-label={`Select folder for ${project.name}`}
            >
              <FolderOpen className="h-3 w-3" />
            </button>
            <button
              type="button"
              data-tab-action="close"
              onClick={() => removeProject(project.id)}
              className="project-tab-close"
              title="Close project"
              aria-label={`Close project ${project.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}

      <button
        type="button"
        onClick={() => void openFolderPicker({ forceNew: true })}
        className="project-tab-new app-no-drag"
        title="New project"
        aria-label="New project"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
