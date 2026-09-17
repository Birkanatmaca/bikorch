import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle
} from 'react-resizable-panels'
import { useRef, useCallback, useState, useEffect } from 'react'
import {
  type PanelDefinition,
  isMobilePreviewPanel,
  type PanelZone,
  type WorkspaceLayout,
  WIDE_LEFT_SIDEBAR_VIEWS
} from '@shared/types'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { PanelShell } from '@renderer/components/panels/PanelShell'
import { SidebarActivityBar } from '@renderer/components/layout/SidebarActivityBar'
import { LeftSidebar } from '@renderer/components/layout/LeftSidebar'
import { useGitStatusBar } from '@renderer/stores/git-store'
import { selectIsolationState, useIsolationStore } from '@renderer/stores/isolation-store'
import { WorkspaceCenterEmpty } from '@renderer/components/workspace/WorkspaceCenterEmpty'
import { OrchestratorZone } from '@renderer/components/workspace/OrchestratorZone'
import { DeveloperSecretary } from '@renderer/components/workspace/DeveloperSecretary'
import { lockTerminalLayout, unlockTerminalLayout } from '@renderer/lib/app-events'
import { cn } from '@renderer/lib/utils'

const DRAG_TYPE = 'application/x-panel-id'
const LAYOUT_EPSILON = 0.5
const LEFT_MIN = 10
const LEFT_MAX = 32
const LEFT_WIDE_MIN = 18
const LEFT_WIDE_SIZE = 24
const LEFT_WIDE_MAX = 36
const RIGHT_MIN = 14
const RIGHT_MAX = 80
const CENTER_MIN = 12

function clampLeftSize(size: number, wideSidebarView = false): number {
  const min = wideSidebarView ? LEFT_WIDE_MIN : LEFT_MIN
  const max = wideSidebarView ? LEFT_WIDE_MAX : LEFT_MAX
  return Math.min(max, Math.max(min, size))
}

function hasLayoutChange(
  current: WorkspaceLayout,
  partial: Partial<WorkspaceLayout>
): boolean {
  return (Object.keys(partial) as Array<keyof WorkspaceLayout>).some((key) => {
    const next = partial[key]
    if (key === 'leftCollapsed') return current.leftCollapsed !== next
    if (typeof next !== 'number') return false
    const currentValue = current[key]
    if (typeof currentValue !== 'number') return false
    return Math.abs(currentValue - next) >= LAYOUT_EPSILON
  })
}

function ZoneDropArea({
  zone,
  panels,
  onDrop,
  isDragOver,
  isDragging,
  onDragOver,
  onDragLeave,
  children,
  emptyContent
}: {
  zone: PanelZone
  panels: PanelDefinition[]
  onDrop: (zone: PanelZone) => void
  isDragOver: boolean
  isDragging: boolean
  onDragOver: (zone: PanelZone) => void
  onDragLeave: () => void
  children: React.ReactNode
  emptyContent?: React.ReactNode
}): React.JSX.Element {
  const dragDepthRef = useRef(0)

  const handleDragEnter = (e: React.DragEvent): void => {
    e.preventDefault()
    dragDepthRef.current += 1
    onDragOver(zone)
  }

  const handleDragLeave = (): void => {
    dragDepthRef.current -= 1
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0
      onDragLeave()
    }
  }

  const showOverlay = isDragging && panels.length > 0

  const bindDropTarget = (className?: string): React.JSX.Element => (
    <div
      className={className}
      onDragEnter={handleDragEnter}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver(zone)
      }}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        onDrop(zone)
        dragDepthRef.current = 0
        onDragLeave()
      }}
    />
  )

  return (
    <div
      className={cn(
        'relative h-full min-h-0 transition-[background-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        isDragOver && 'ring-2 ring-inset ring-primary/35 bg-primary/5'
      )}
    >
      {panels.length === 0 ? (
        isDragging ? (
          bindDropTarget(
            'flex h-full items-center justify-center rounded-md border border-dashed border-primary/40 bg-primary/5 p-4'
          )
        ) : emptyContent ? (
          emptyContent
        ) : (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border bg-app-bg/50 p-4">
            <div className="text-center">
              <p className="text-xs font-medium text-text-secondary">Drop panel here</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                {zone}
              </p>
            </div>
          </div>
        )
      ) : (
        children
      )}

      {showOverlay && bindDropTarget('absolute inset-0 z-20')}
    </div>
  )
}

function ZonePanels({
  panels,
  zone,
  onDragStart,
  onDragEnd,
  onClose,
  onHideSidebar
}: {
  panels: PanelDefinition[]
  zone: PanelZone
  onDragStart: (panelId: string) => (e: React.DragEvent) => void
  onDragEnd: () => void
  onClose: (panelId: string) => void
  onHideSidebar?: () => void
}): React.JSX.Element {
  const getPanelActions = (
    panel: PanelDefinition
  ): { onClose?: () => void; onHide?: () => void } => {
    if (zone === 'left' && panel.type === 'file-explorer' && onHideSidebar) {
      return { onHide: onHideSidebar }
    }
    return { onClose: () => onClose(panel.id) }
  }
  const isDirectDevice = (panel: PanelDefinition): boolean => isMobilePreviewPanel(panel.type)

  if (panels.length === 1) {
    const panel = panels[0]
    return (
      <PanelShell
        id={panel.id}
        type={panel.type}
        title={panel.title}
        {...getPanelActions(panel)}
        onDragStart={onDragStart(panel.id)}
        onDragEnd={onDragEnd}
        launchMode={panel.launchMode}
        accountId={panel.accountId}
        showHeader={!isDirectDevice(panel)}
        flush={isDirectDevice(panel)}
      />
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      {panels.map((panel) => (
        <div key={panel.id} className="min-h-0 flex-1">
          <PanelShell
            id={panel.id}
            type={panel.type}
            title={panel.title}
            {...getPanelActions(panel)}
            onDragStart={onDragStart(panel.id)}
            onDragEnd={onDragEnd}
            launchMode={panel.launchMode}
            accountId={panel.accountId}
            showHeader={!isDirectDevice(panel)}
            flush={isDirectDevice(panel)}
          />
        </div>
      ))}
    </div>
  )
}

export function WorkspaceLayout(): React.JSX.Element {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const project = useWorkspaceStore((s) => s.projects.find((item) => item.id === s.activeProjectId))
  const workspace = useWorkspaceStore((s) =>
    activeProjectId ? s.workspaces[activeProjectId] : null
  )
  const movePanel = useWorkspaceStore((s) => s.movePanel)
  const removePanel = useWorkspaceStore((s) => s.removePanel)
  const updateLayout = useWorkspaceStore((s) => s.updateLayout)
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar)
  const collapseLeftSidebar = useWorkspaceStore((s) => s.collapseLeftSidebar)
  const selectLeftSidebar = useWorkspaceStore((s) => s.selectLeftSidebar)
  const ensureProjectWorkspace = useWorkspaceStore((s) => s.ensureProjectWorkspace)
  const { changesCount } = useGitStatusBar(activeProjectId)
  const isolation = useIsolationStore((s) => selectIsolationState(s.byProject, activeProjectId))
  const overlapCount = isolation.overlaps.length
  const isolationConflict = isolation.fold?.status === 'conflict'

  useEffect(() => {
    if (activeProjectId) {
      ensureProjectWorkspace(activeProjectId)
    }
  }, [activeProjectId, ensureProjectWorkspace])

  const [dragOverZone, setDragOverZone] = useState<PanelZone | null>(null)
  const [draggingPanelId, setDraggingPanelId] = useState<string | null>(null)
  const [layoutResizing, setLayoutResizing] = useState(false)
  const [overlayDragWidth, setOverlayDragWidth] = useState<number | null>(null)
  const draggingPanelIdRef = useRef<string | null>(null)
  const overlayDragWidthRef = useRef<number | null>(null)
  const workspaceMainRef = useRef<HTMLDivElement>(null)
  const verticalGroupRef = useRef<ImperativePanelGroupHandle>(null)
  const horizontalGroupRef = useRef<ImperativePanelGroupHandle>(null)

  const handleDragStart = useCallback(
    (panelId: string) => (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', panelId)
      e.dataTransfer.setData(DRAG_TYPE, panelId)
      e.dataTransfer.effectAllowed = 'move'
      draggingPanelIdRef.current = panelId
      setDraggingPanelId(panelId)
    },
    []
  )

  const handleDragEnd = useCallback(() => {
    draggingPanelIdRef.current = null
    setDraggingPanelId(null)
    setDragOverZone(null)
  }, [])

  const handleDrop = useCallback(
    (zone: PanelZone) => {
      const panelId = draggingPanelIdRef.current
      if (!panelId) return
      movePanel(panelId, zone)
      draggingPanelIdRef.current = null
      setDraggingPanelId(null)
      setDragOverZone(null)
    },
    [movePanel]
  )

  const handleVerticalLayout = useCallback(
    (sizes: number[]) => {
      if (sizes.length < 2 || !activeProjectId) return
      const current = useWorkspaceStore.getState().workspaces[activeProjectId]?.layout
      if (!current) return

      const partial = {
        mainVerticalSize: sizes[0],
        bottomSize: sizes[1]
      }

      if (!hasLayoutChange(current, partial)) return
      updateLayout(activeProjectId, partial)
    },
    [activeProjectId, updateLayout]
  )

  const handleHorizontalLayout = useCallback(
    (sizes: number[]) => {
      if (!activeProjectId || sizes.length < 2) return
      const current = useWorkspaceStore.getState().workspaces[activeProjectId]?.layout
      if (!current) return

      const hasRight =
        (useWorkspaceStore.getState().workspaces[activeProjectId]?.panels.filter(
          (p) => p.zone === 'right'
        ).length ?? 0) > 0
      if (!hasRight) return

      const partial = {
        centerSize: sizes[0],
        rightSize: sizes[1]
      }
      if (!hasLayoutChange(current, partial)) return
      updateLayout(activeProjectId, partial)
    },
    [activeProjectId, updateLayout]
  )

  const handleLayoutDragging = useCallback((dragging: boolean) => {
    if (dragging) {
      lockTerminalLayout()
      setLayoutResizing(true)
      return
    }
    setLayoutResizing(false)
    unlockTerminalLayout()
  }, [])

  const beginOverlayResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!activeProjectId) return
      event.preventDefault()
      event.stopPropagation()
      const parent = workspaceMainRef.current
      const handle = event.currentTarget
      if (!parent) return
      handle.setPointerCapture(event.pointerId)
      lockTerminalLayout()
      setLayoutResizing(true)

      const onMove = (moveEvent: PointerEvent): void => {
        const rect = parent.getBoundingClientRect()
        if (rect.width <= 0) return
        const wide = (WIDE_LEFT_SIDEBAR_VIEWS as readonly string[]).includes(
          useWorkspaceStore.getState().workspaces[activeProjectId]?.layout.leftSidebarView ??
            'files'
        )
        const next = clampLeftSize(((moveEvent.clientX - rect.left) / rect.width) * 100, wide)
        overlayDragWidthRef.current = next
        setOverlayDragWidth(next)
      }

      const onUp = (): void => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        const next = overlayDragWidthRef.current
        if (next != null) {
          const wide = (WIDE_LEFT_SIDEBAR_VIEWS as readonly string[]).includes(
            useWorkspaceStore.getState().workspaces[activeProjectId]?.layout.leftSidebarView ??
              'files'
          )
          updateLayout(activeProjectId, { leftSize: clampLeftSize(next, wide) })
        }
        overlayDragWidthRef.current = null
        setOverlayDragWidth(null)
        setLayoutResizing(false)
        unlockTerminalLayout()
      }

      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    },
    [activeProjectId, updateLayout]
  )

  const handleWorkspacePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!activeProjectId) return
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('.workspace-sidebar-overlay')) return
      collapseLeftSidebar(activeProjectId)
    },
    [activeProjectId, collapseLeftSidebar]
  )

  const leftCollapsed = workspace?.layout.leftCollapsed ?? false
  const hasLeftPanel = workspace?.panels.some((p) => p.zone === 'left') ?? false
  const leftSidebarView = workspace?.layout.leftSidebarView ?? 'files'
  const isWideSidebarView = (WIDE_LEFT_SIDEBAR_VIEWS as readonly string[]).includes(leftSidebarView)

  if (!workspace || !activeProjectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
        No active project
      </div>
    )
  }

  const { panels, layout } = workspace
  const byZone = (zone: PanelZone): PanelDefinition[] => panels.filter((p) => p.zone === zone)
  const leftPanels = byZone('left')
  const centerPanels = byZone('center')
  const rightPanels = byZone('right')
  const bottomPanels = byZone('bottom')
  const showLeftSidebar = hasLeftPanel && !leftCollapsed
  const leftSize = overlayDragWidth ?? (isWideSidebarView
    ? Math.max(clampLeftSize(layout.leftSize || 14, true), LEFT_WIDE_SIZE)
    : clampLeftSize(layout.leftSize || 14))
  const hasRight = rightPanels.length > 0
  const hasBottom = bottomPanels.length > 0

  const layoutGroupClass = cn(
    'layout-panel-group h-full',
    layoutResizing ? 'layout-resizing' : 'layout-idle'
  )

  const mainContent = (
    <PanelGroup
      ref={horizontalGroupRef}
      direction="horizontal"
      className={layoutGroupClass}
      onLayout={handleHorizontalLayout}
      style={{ direction: 'ltr' }}
    >
      <Panel
        id="workspace-center"
        order={1}
        defaultSize={hasRight ? Math.max(CENTER_MIN, 100 - (layout.rightSize || 36)) : 100}
        minSize={CENTER_MIN}
      >
        <ZoneDropArea
          zone="center"
          panels={centerPanels}
          onDrop={handleDrop}
          isDragOver={dragOverZone === 'center'}
          isDragging={draggingPanelId !== null}
          onDragOver={setDragOverZone}
          onDragLeave={() => setDragOverZone(null)}
          emptyContent={<WorkspaceCenterEmpty />}
        >
          <OrchestratorZone
            projectId={activeProjectId}
            panels={centerPanels}
            layout={layout}
            onClose={removePanel}
          />
        </ZoneDropArea>
      </Panel>

      {hasRight && (
        <>
          <PanelResizeHandle className="app-no-drag" onDragging={handleLayoutDragging} />
          <Panel
            id="diff-sidebar"
            order={2}
            defaultSize={layout.rightSize || 36}
            minSize={RIGHT_MIN}
            maxSize={RIGHT_MAX}
          >
            <ZoneDropArea
              zone="right"
              panels={rightPanels}
              onDrop={handleDrop}
              isDragOver={dragOverZone === 'right'}
              isDragging={draggingPanelId !== null}
              onDragOver={setDragOverZone}
              onDragLeave={() => setDragOverZone(null)}
            >
              <ZonePanels
                zone="right"
                panels={rightPanels}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onClose={removePanel}
              />
            </ZoneDropArea>
          </Panel>
        </>
      )}
    </PanelGroup>
  )

  return (
    <div className={cn('workspace-frame flex min-h-0 flex-1', layoutResizing && 'is-layout-resizing')}>
      <SidebarActivityBar
        isOpen={!leftCollapsed}
        view={layout.leftSidebarView ?? 'files'}
        changesCount={changesCount}
        overlapCount={overlapCount}
        conflict={isolationConflict}
        onSelectFiles={() => selectLeftSidebar(activeProjectId, 'files')}
        onSelectChanges={() => selectLeftSidebar(activeProjectId, 'changes')}
        onSelectAccounts={() => selectLeftSidebar(activeProjectId, 'accounts')}
        onSelectTasks={() => selectLeftSidebar(activeProjectId, 'tasks')}
        onSelectProfile={() => selectLeftSidebar(activeProjectId, 'profile')}
        onSelectAutomation={() => selectLeftSidebar(activeProjectId, 'automation')}
        onSelectMusic={() => selectLeftSidebar(activeProjectId, 'music')}
        onSelectTimer={() => selectLeftSidebar(activeProjectId, 'timer')}
      />
      <div
        ref={workspaceMainRef}
        className="workspace-main relative flex min-h-0 min-w-0 flex-1 flex-col"
        onPointerDownCapture={handleWorkspacePointerDown}
      >
        {showLeftSidebar && (
          <div
            className="workspace-sidebar-overlay"
            style={{ width: `${leftSize}%` }}
          >
            <ZoneDropArea
              zone="left"
              panels={leftPanels}
              onDrop={handleDrop}
              isDragOver={dragOverZone === 'left'}
              isDragging={draggingPanelId !== null}
              onDragOver={setDragOverZone}
              onDragLeave={() => setDragOverZone(null)}
            >
              <LeftSidebar
                view={leftSidebarView}
                onHide={() => toggleSidebar(activeProjectId)}
              />
            </ZoneDropArea>
            <div
              className="workspace-sidebar-overlay-handle app-no-drag"
              onPointerDown={beginOverlayResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
            />
          </div>
        )}
        <div className="min-h-0 min-w-0 flex-1">
        {hasBottom ? (
        <PanelGroup
          ref={verticalGroupRef}
          direction="vertical"
          className={layoutGroupClass}
          onLayout={handleVerticalLayout}
        >
          <Panel defaultSize={layout.mainVerticalSize} minSize={30}>
            {mainContent}
          </Panel>
          <PanelResizeHandle
            className="app-no-drag"
            onDragging={handleLayoutDragging}
          />
          <Panel defaultSize={layout.bottomSize} minSize={10} maxSize={60}>
            <ZoneDropArea
              zone="bottom"
              panels={bottomPanels}
              onDrop={handleDrop}
              isDragOver={dragOverZone === 'bottom'}
              isDragging={draggingPanelId !== null}
              onDragOver={setDragOverZone}
              onDragLeave={() => setDragOverZone(null)}
            >
              <ZonePanels
                zone="bottom"
                panels={bottomPanels}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onClose={removePanel}
              />
            </ZoneDropArea>
          </Panel>
        </PanelGroup>
        ) : (
          mainContent
        )}
        </div>
        {project ? <DeveloperSecretary project={project} panels={panels} /> : null}
      </div>
    </div>
  )
}
