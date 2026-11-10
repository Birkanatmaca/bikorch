import { useRef } from 'react'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useActivityAttentionStore } from '@renderer/stores/activity-attention-store'
import { useOpenProject } from '@renderer/hooks/use-open-project'
import { useProjectSessionSummaries } from '@renderer/hooks/use-session-signals'
import {
  SESSION_SIGNAL_LABEL,
  formatElapsed,
  type ProjectSessionSummary,
  type SessionSignal
} from '@renderer/lib/project-activity'
import { focusWorkspacePanel } from '@renderer/lib/app-events'
import { SignalIcon } from '@renderer/components/ui/SessionBadge'
import { cn, formatProjectName } from '@renderer/lib/utils'
import { FolderOpen, House, Plus, X } from 'lucide-react'
import type { Project } from '@shared/types'

const EMPTY_SUMMARY: ProjectSessionSummary = {
  top: null,
  counts: { asking: 0, error: 0, working: 0, done: 0, idle: 0, off: 0 },
  rows: []
}

const PILL_SIGNALS: SessionSignal[] = ['asking', 'error', 'working', 'done']

/** One line per session for the tab tooltip: "Claude 1 — Working · 3m". */
function summaryLines(summary: ProjectSessionSummary): string[] {
  return summary.rows
    .filter((row) => row.signal !== 'idle' && row.signal !== 'off')
    .map((row) => `${row.title} — ${SESSION_SIGNAL_LABEL[row.signal]}${row.since ? ` · ${formatElapsed(row.since)}` : ''}`)
}

function summaryLabel(summary: ProjectSessionSummary): string {
  return PILL_SIGNALS
    .filter((signal) => summary.counts[signal] > 0)
    .map((signal) => `${summary.counts[signal]} ${SESSION_SIGNAL_LABEL[signal].toLowerCase()}`)
    .join(', ')
}

function TabFace({ project, summary }: { project: Project; summary: ProjectSessionSummary }): React.JSX.Element {
  const active = PILL_SIGNALS.filter((signal) => summary.counts[signal] > 0)
  // The icon already says it when only one session has something to show.
  const showPills = active.length > 1 || (active.length === 1 && summary.counts[active[0]] > 1)
  return (
    <>
      {summary.top ? <SignalIcon signal={summary.top} className="project-tab-signal" /> : <span className="project-tab-dot" aria-hidden />}
      <span className="project-tab-name">{project.name}</span>
      {showPills && (
        <span className="project-tab-pills" aria-hidden>
          {active.map((signal) => (
            <span key={signal} className={cn('project-tab-pill', `is-${signal}`)}>{summary.counts[signal]}</span>
          ))}
        </span>
      )}
    </>
  )
}

export function ProjectTabs(): React.JSX.Element {
  const projects = useWorkspaceStore((s) => s.projects)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const homeVisible = useWorkspaceStore((s) => s.homeVisible)
  const showHome = useWorkspaceStore((s) => s.showHome)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  const removeProject = useWorkspaceStore((s) => s.removeProject)
  const updateProject = useWorkspaceStore((s) => s.updateProject)
  const summaries = useProjectSessionSummaries()
  const { openFolderPicker } = useOpenProject()
  const listRef = useRef<HTMLDivElement>(null)
  const draggedProjectIdRef = useRef<string | null>(null)
  const draggedTabRef = useRef<HTMLDivElement | null>(null)
  const dropTabRef = useRef<HTMLDivElement | null>(null)

  const summaryFor = (projectId: string): ProjectSessionSummary => summaries[projectId] ?? EMPTY_SUMMARY

  // Opening a project goes straight to the session that most needs the user.
  const activateProject = (projectId: string): void => {
    const target = summaryFor(projectId).rows.find((row) =>
      (row.signal === 'asking' || row.signal === 'error' || row.signal === 'done') && !row.panelId.startsWith('secretary:'))
    setActiveProject(projectId)
    useActivityAttentionStore.getState().clearDetached(projectId)
    if (target) window.setTimeout(() => focusWorkspacePanel(target.panelId), 40)
  }

  // Home carries what needs the user across all projects.
  const homeCounts = Object.values(summaries).reduce(
    (sum, summary) => ({
      asking: sum.asking + summary.counts.asking,
      error: sum.error + summary.counts.error,
      done: sum.done + summary.counts.done,
      working: sum.working + summary.counts.working
    }),
    { asking: 0, error: 0, done: 0, working: 0 }
  )
  const homeAttention = homeCounts.asking + homeCounts.error + homeCounts.done
  const homeTop: SessionSignal | null = homeCounts.asking ? 'asking' : homeCounts.error ? 'error' : homeCounts.done ? 'done' : homeCounts.working ? 'working' : null
  const homeTitle = homeTop
    ? `Home — ${[
        homeCounts.asking && `${homeCounts.asking} need you`,
        homeCounts.error && `${homeCounts.error} with errors`,
        homeCounts.working && `${homeCounts.working} working`,
        homeCounts.done && `${homeCounts.done} done`
      ].filter(Boolean).join(', ')}`
    : 'Home'

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

  const finishDragging = (): void => {
    draggedTabRef.current?.classList.remove('is-dragging')
    dropTabRef.current?.classList.remove('is-drop-target')
    draggedProjectIdRef.current = null
    draggedTabRef.current = null
    dropTabRef.current = null
  }

  const setDropTarget = (tab: HTMLDivElement): void => {
    if (dropTabRef.current === tab) return
    dropTabRef.current?.classList.remove('is-drop-target')
    dropTabRef.current = tab
    tab.classList.add('is-drop-target')
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>, targetProjectId: string): void => {
    event.preventDefault()
    const sourceProjectId = event.dataTransfer.getData('application/x-bikorch-project') || draggedProjectIdRef.current
    if (!sourceProjectId || sourceProjectId === targetProjectId) {
      finishDragging()
      return
    }
    const fromIndex = projects.findIndex((project) => project.id === sourceProjectId)
    const toIndex = projects.findIndex((project) => project.id === targetProjectId)
    if (fromIndex >= 0 && toIndex >= 0) {
      useWorkspaceStore.getState().reorderProjects(fromIndex, toIndex)
    }
    finishDragging()
  }

  return (
    <div
      ref={listRef}
      className="project-tabs relative flex h-full min-w-0 w-full items-center overflow-x-auto"
      role="tablist"
      aria-label="Open projects"
    >
      <button
        type="button"
        role="tab"
        aria-selected={homeVisible}
        className={cn('project-home-tab app-no-drag', homeVisible && 'is-active')}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          showHome()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') showHome()
        }}
        title={homeTitle}
        aria-label={homeTitle}
      >
        <House className="h-4 w-4" aria-hidden />
        {homeTop && !homeVisible && (
          <span className={cn('project-home-badge', `is-${homeTop}`)} aria-hidden>
            {homeAttention > 0 ? homeAttention : ''}
          </span>
        )}
      </button>
      {projects.map((project) => {
        const isActive = !homeVisible && project.id === activeProjectId
        const summary = summaryFor(project.id)
        const lines = summaryLines(summary)
        const tabTitle = [project.folderPath || project.name, ...(lines.length > 0 ? ['', ...lines] : [])].join('\n')
        const label = summaryLabel(summary)

        return (
          <div
            key={project.id}
            data-project-id={project.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('application/x-bikorch-project', project.id)
              draggedProjectIdRef.current = project.id
              draggedTabRef.current = event.currentTarget
              event.currentTarget.classList.add('is-dragging')
            }}
            onDragOver={(event) => {
              if (draggedProjectIdRef.current === project.id) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDropTarget(event.currentTarget)
            }}
            onDragLeave={(event) => {
              const nextTarget = event.relatedTarget
              if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
              if (dropTabRef.current?.dataset.projectId !== project.id) return
              dropTabRef.current.classList.remove('is-drop-target')
              dropTabRef.current = null
            }}
            onDrop={(event) => handleDrop(event, project.id)}
            onDragEnd={finishDragging}
            onPointerDown={(event) => handleActivate(event, project.id)}
            role="tab"
            aria-selected={isActive}
            aria-label={label ? `${project.name}. ${label}` : project.name}
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
              summary.top && `has-${summary.top}`
            )}
          >
            <TabFace project={project} summary={summary} />
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
