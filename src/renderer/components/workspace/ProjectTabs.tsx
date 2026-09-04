import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useOpenProject } from '@renderer/hooks/use-open-project'
import { cn, formatProjectName } from '@renderer/lib/utils'
import { FolderOpen, GripVertical, Plus, X } from 'lucide-react'
import type { Project } from '@shared/types'

const DRAG_THRESHOLD_PX = 4
const EDGE_SCROLL_PX = 40
const TAB_GAP_PX = 4
const SETTLE_MS = 280

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
  compact
}: {
  project: Project
  isActive: boolean
  compact?: boolean
}): React.JSX.Element {
  return (
    <>
      {isActive && (
        <>
          <span className="project-tab-rank" aria-hidden />
          <span className="project-tab-stripes" aria-hidden />
          <span className="project-tab-ambient" aria-hidden />
          <span className="project-tab-sheen" aria-hidden />
          <span className="project-tab-rail" aria-hidden />
        </>
      )}
      <GripVertical
        className={cn(
          'relative z-[1] h-3 w-3 shrink-0 text-text-muted/70',
          compact ? 'opacity-80' : 'opacity-0 transition-opacity duration-200 group-hover:opacity-60'
        )}
        aria-hidden
      />
      <span className="relative z-[1] min-w-0 flex-1 truncate text-xs font-medium">{project.name}</span>
    </>
  )
}

export function ProjectTabs(): React.JSX.Element {
  const projects = useWorkspaceStore((s) => s.projects)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  const removeProject = useWorkspaceStore((s) => s.removeProject)
  const updateProject = useWorkspaceStore((s) => s.updateProject)
  const reorderProjects = useWorkspaceStore((s) => s.reorderProjects)
  const { openFolderPicker } = useOpenProject()
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
    setActiveProject(projectId)
  }

  const dragged = session ? projects.find((project) => project.id === session.id) : null
  const remaining = session ? projects.filter((project) => project.id !== session.id) : projects
  const shift = session ? session.width + TAB_GAP_PX : 0

  return (
    <div
      ref={listRef}
      className={cn(
        'project-tabs relative flex h-full min-w-0 w-full items-center gap-1 overflow-x-auto app-no-drag',
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

        return (
          <div
            key={project.id}
            data-project-id={project.id}
            onPointerDown={(event) => handlePointerDown(event, project.id)}
            onDragStart={(event) => event.preventDefault()}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setActiveProject(project.id)
              }
            }}
            className={cn(
              'project-tab group relative flex max-w-[200px] items-center gap-1 rounded-lg border px-2 py-0.5 app-no-drag',
              isActive
                ? 'project-tab-active border-primary/55 bg-primary/14 pl-1.5 text-text-primary backdrop-blur-md'
                : 'border-transparent pl-1 text-text-secondary hover:border-primary/25 hover:bg-primary/5 hover:text-text-primary',
              isDragged && 'project-tab-origin'
            )}
            style={{
              transform: isDragged ? undefined : `translateX(${translateX}px)`,
              zIndex: isDragged ? 0 : translateX ? 1 : undefined
            }}
          >
            <TabFace project={project} isActive={isActive} />
            <button
              type="button"
              data-tab-action="folder"
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
              data-tab-action="close"
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
        onClick={() => void openFolderPicker({ forceNew: true })}
        className="glass-button app-no-drag h-7 w-7 shrink-0 border-dashed p-0"
        style={{ transform: session ? `translateX(${shift}px)` : undefined }}
        title="New project"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      {session &&
        dragged &&
        createPortal(
          <div
            className={cn(
              'project-tab-float pointer-events-none flex items-center gap-1 rounded-lg border px-2 py-0.5',
              dragged.id === activeProjectId
                ? 'project-tab-active border-primary/55 bg-primary/14 pl-1.5 text-text-primary'
                : 'border-primary/35 bg-elevated/95 pl-1 text-text-primary',
              session.settling && 'project-tab-float-settle'
            )}
            style={{
              width: session.width,
              height: session.height,
              transform: `translate3d(${session.floatX}px, ${session.floatY}px, 0) scale(${session.settling ? 1 : 1.06})`,
            }}
          >
            <TabFace project={dragged} isActive={dragged.id === activeProjectId} compact />
          </div>,
          document.body
        )}
    </div>
  )
}
