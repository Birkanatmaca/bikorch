import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useActivityAttentionStore } from '@renderer/stores/activity-attention-store'
import { useOpenProject } from '@renderer/hooks/use-open-project'
import { summarizeProjectTabActivity, type ProjectTabActivity } from '@renderer/lib/project-activity'
import { focusWorkspacePanel } from '@renderer/lib/app-events'
import { cn, formatProjectName } from '@renderer/lib/utils'
import { FolderOpen, Plus, X } from 'lucide-react'
import type { Project } from '@shared/types'

const DRAG_THRESHOLD_PX = 4
const EDGE_SCROLL_PX = 40
const TAB_GAP_PX = 2
const SETTLE_MS = 180

interface DragSession {
  id: string
  pointerId: number
  fromIndex: number
  dropIndex: number
  width: number
  height: number
  grabOffsetX: number
  floatX: number
  floatY: number
  liftY: number
  settling: boolean
}

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
      {activity.signal === 'busy' && activity.busyCount > 1 && (
        <span className="project-tab-mark is-busy">{activity.busyCount}</span>
      )}
      {activity.signal === 'ready' && <span className="project-tab-mark is-ready">Done</span>}
      {activity.signal === 'error' && <span className="project-tab-mark is-error">Err</span>}
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
  const reorderProjects = useWorkspaceStore((s) => s.reorderProjects)
  const sessions = useTerminalStore((s) => s.sessions)
  const attentionByProject = useActivityAttentionStore((s) => s.attentionByProject)
  const { openFolderPicker } = useOpenProject()

  const activityFor = (projectId: string): ProjectTabActivity =>
    summarizeProjectTabActivity({
      panels: workspaces[projectId]?.panels ?? [],
      sessions,
      attention: attentionByProject[projectId] ?? []
    })

  const activateProject = (projectId: string): void => {
    const pending = useActivityAttentionStore.getState().attentionByProject[projectId]
    const review = pending?.reduce((latest, item) => (item.at >= latest.at ? item : latest), pending[0])
    setActiveProject(projectId)
    if (!review) return
    window.setTimeout(() => focusWorkspacePanel(review.panelId), 40)
  }
  const listRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef<{
    id: string
    pointerId: number
    startX: number
    grabOffsetX: number
  } | null>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const settleTimerRef = useRef<number | null>(null)
  const [session, setSession] = useState<DragSession | null>(null)
  const [slotLeft, setSlotLeft] = useState<number | null>(null)

  const handleSelectFolder = async (projectId: string): Promise<void> => {
    const folder = await window.api.selectFolder()
    if (folder) {
      updateProject(projectId, {
        folderPath: folder,
        name: formatProjectName(folder, 'Untitled')
      })
    }
  }

  const dropIndexFromX = (clientX: number, draggedId: string): number => {
    const root = listRef.current
    if (!root) return 0
    const listRect = root.getBoundingClientRect()
    const tabs = [...root.querySelectorAll<HTMLElement>('[data-project-id]')].filter(
      (tab) => tab.dataset.projectId !== draggedId
    )
    for (let index = 0; index < tabs.length; index += 1) {
      const tab = tabs[index]
      const mid = listRect.left - root.scrollLeft + tab.offsetLeft + tab.offsetWidth / 2
      if (clientX < mid) return index
    }
    return tabs.length
  }

  const ghostLeft = (dropIndex: number, draggedId: string): number => {
    const root = listRef.current
    if (!root) return 0
    const tabs = [...root.querySelectorAll<HTMLElement>('[data-project-id]')].filter(
      (tab) => tab.dataset.projectId !== draggedId
    )
    if (tabs.length === 0) return 0
    if (dropIndex >= tabs.length) {
      const last = tabs[tabs.length - 1]
      return last.offsetLeft + last.offsetWidth + TAB_GAP_PX
    }
    return tabs[dropIndex].offsetLeft
  }

  const scrollWhileDragging = (clientX: number): void => {
    const root = listRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    if (clientX < rect.left + EDGE_SCROLL_PX) root.scrollLeft -= 18
    else if (clientX > rect.right - EDGE_SCROLL_PX) root.scrollLeft += 18
  }

  const finishDrag = (next: DragSession): void => {
    if (next.fromIndex !== next.dropIndex) {
      reorderProjects(next.fromIndex, next.dropIndex)
    }
    sessionRef.current = null
    setSession(null)
    document.body.style.removeProperty('cursor')
    document.body.classList.remove('project-tabs-grabbing')
  }

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const pending = pendingRef.current
      const current = sessionRef.current

      if (pending && event.pointerId === pending.pointerId && !current) {
        if (Math.abs(event.clientX - pending.startX) < DRAG_THRESHOLD_PX) return
        const tab = listRef.current?.querySelector<HTMLElement>(
          `[data-project-id="${pending.id}"]`
        )
        if (!tab) return
        const rect = tab.getBoundingClientRect()
        const fromIndex = useWorkspaceStore
          .getState()
          .projects.findIndex((project) => project.id === pending.id)
        if (fromIndex < 0) return

        const next: DragSession = {
          id: pending.id,
          pointerId: pending.pointerId,
          fromIndex,
          dropIndex: fromIndex,
          width: rect.width,
          height: rect.height,
          grabOffsetX: pending.grabOffsetX,
          floatX: event.clientX - pending.grabOffsetX,
          floatY: rect.top - 3,
          liftY: rect.top,
          settling: false
        }
        pendingRef.current = null
        sessionRef.current = next
        setSession(next)
        document.body.style.cursor = 'grabbing'
        document.body.classList.add('project-tabs-grabbing')
        return
      }

      if (!current || current.settling || event.pointerId !== current.pointerId) return
      scrollWhileDragging(event.clientX)
      const dropIndex = dropIndexFromX(event.clientX, current.id)
      const next: DragSession = {
        ...current,
        dropIndex,
        floatX: event.clientX - current.grabOffsetX,
        floatY: current.liftY - 3
      }
      sessionRef.current = next
      setSession(next)
    }

    const onUp = (event: PointerEvent): void => {
      const pending = pendingRef.current
      if (pending && event.pointerId === pending.pointerId) {
        pendingRef.current = null
      }

      const current = sessionRef.current
      if (!current || event.pointerId !== current.pointerId || current.settling) return

      const root = listRef.current
      const targetLeft = root
        ? root.getBoundingClientRect().left - root.scrollLeft + ghostLeft(current.dropIndex, current.id)
        : current.floatX
      const settling: DragSession = {
        ...current,
        settling: true,
        floatX: targetLeft,
        floatY: current.liftY
      }
      sessionRef.current = settling
      setSession(settling)
      settleTimerRef.current = window.setTimeout(() => finishDrag(settling), SETTLE_MS)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [reorderProjects])

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current)
      document.body.style.removeProperty('cursor')
      document.body.classList.remove('project-tabs-grabbing')
    }
  }, [])

  useLayoutEffect(() => {
    if (!session?.id) {
      setSlotLeft(null)
      return
    }
    setSlotLeft(ghostLeft(session.dropIndex, session.id))
  }, [session?.dropIndex, session?.id])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, projectId: string): void => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('[data-tab-action]')) return
    if (sessionRef.current?.settling) return

    const rect = event.currentTarget.getBoundingClientRect()
    pendingRef.current = {
      id: projectId,
      pointerId: event.pointerId,
      startX: event.clientX,
      grabOffsetX: event.clientX - rect.left
    }
    activateProject(projectId)
  }

  const dragged = session ? projects.find((project) => project.id === session.id) : null
  const remaining = session ? projects.filter((project) => project.id !== session.id) : projects
  const shift = session ? session.width + TAB_GAP_PX : 0

  return (
    <div
      ref={listRef}
      className={cn(
        'project-tabs relative flex h-full min-w-0 w-full items-center overflow-x-auto app-no-drag',
        session && 'project-tabs-reordering'
      )}
      role="tablist"
      aria-label="Open projects"
    >
      {session && slotLeft !== null && (
        <div
          className="project-tab-slot pointer-events-none absolute top-1/2 z-0"
          style={{
            left: slotLeft,
            width: session.width,
            height: session.height,
            marginTop: -session.height / 2
          }}
          aria-hidden
        />
      )}

      {projects.map((project) => {
        const isActive = project.id === activeProjectId
        const isDragged = session?.id === project.id
        const remainingIndex = remaining.findIndex((item) => item.id === project.id)
        const translateX =
          session && remainingIndex >= 0 && remainingIndex >= session.dropIndex ? shift : 0
        const activity = activityFor(project.id)
        const tabTitle = [project.folderPath || project.name, activity.label].filter(Boolean).join(' · ')

        return (
          <div
            key={project.id}
            data-project-id={project.id}
            onPointerDown={(event) => handlePointerDown(event, project.id)}
            onDragStart={(event) => event.preventDefault()}
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
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? projects.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + projects.length) % projects.length
                setActiveProject(projects[next].id)
                const tabs = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')
                tabs?.[next]?.focus()
              }
            }}
            className={cn(
              'project-tab group relative flex max-w-[196px] items-center gap-1.5 app-no-drag',
              isActive ? 'is-active' : 'is-idle',
              activity.signal === 'busy' && 'is-working',
              activity.signal === 'ready' && 'is-ready',
              activity.signal === 'error' && 'is-alert',
              isDragged && 'project-tab-origin'
            )}
            style={{
              transform: isDragged ? undefined : `translateX(${translateX}px)`,
              zIndex: isDragged ? 0 : translateX ? 1 : undefined
            }}
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
        style={{ transform: session ? `translateX(${shift}px)` : undefined }}
        title="New project"
        aria-label="New project"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      {session &&
        dragged &&
        createPortal(
          <div
            className={cn(
              'project-tab-float pointer-events-none flex items-center gap-1.5',
              dragged.id === activeProjectId ? 'is-active' : 'is-idle',
              activityFor(dragged.id).signal === 'busy' && 'is-working',
              activityFor(dragged.id).signal === 'ready' && 'is-ready',
              activityFor(dragged.id).signal === 'error' && 'is-alert',
              session.settling && 'project-tab-float-settle'
            )}
            style={{
              width: session.width,
              height: session.height,
              transform: `translate3d(${session.floatX}px, ${session.floatY}px, 0) scale(${session.settling ? 1 : 1.06})`,
            }}
          >
            <TabFace
              project={dragged}
              isActive={dragged.id === activeProjectId}
              activity={activityFor(dragged.id)}
            />
          </div>,
          document.body
        )}
    </div>
  )
}
