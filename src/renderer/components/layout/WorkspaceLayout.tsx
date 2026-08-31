import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
  type ImperativePanelHandle
} from 'react-resizable-panels'
import { useRef, useCallback, useState, useEffect } from 'react'
import { type PanelDefinition, type PanelZone, type WorkspaceLayout } from '@shared/types'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { PanelShell } from '@renderer/components/panels/PanelShell'
import { SidebarActivityBar } from '@renderer/components/layout/SidebarActivityBar'
import { LeftSidebar } from '@renderer/components/layout/LeftSidebar'
import { useGitStatusBar } from '@renderer/stores/git-store'
import { WorkspaceCenterEmpty } from '@renderer/components/workspace/WorkspaceCenterEmpty'
import { OrchestratorZone } from '@renderer/components/workspace/OrchestratorZone'
import { cn } from '@renderer/lib/utils'

const DRAG_TYPE = 'application/x-panel-id'
const LAYOUT_EPSILON = 0.5
const LEFT_MIN = 10
const LEFT_MAX = 32
const RIGHT_MIN = 14
const RIGHT_MAX = 80
const CENTER_MIN = 12

function clampLeftSize(size: number): number {
  return Math.min(LEFT_MAX, Math.max(LEFT_MIN, size))
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
        'relative h-full min-h-0 transition-colors',
        isDragOver && 'ring-2 ring-inset ring-primary/40'
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
      />
    )
  }

  return (
    <div className="flex h-full flex-col gap-1 overflow-hidden">
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
          />
        </div>
      ))}
    </div>
  )
}

export function WorkspaceLayout(): React.JSX.Element {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const workspace = useWorkspaceStore((s) =>
    activeProjectId ? s.workspaces[activeProjectId] : null
  )
  const movePanel = useWorkspaceStore((s) => s.movePanel)
  const removePanel = useWorkspaceStore((s) => s.removePanel)
  const updateLayout = useWorkspaceStore((s) => s.updateLayout)
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar)
  const selectLeftSidebar = useWorkspaceStore((s) => s.selectLeftSidebar)
  const ensureProjectWorkspace = useWorkspaceStore((s) => s.ensureProjectWorkspace)
  const { changesCount } = useGitStatusBar(activeProjectId)

  useEffect(() => {
    if (activeProjectId) {
      ensureProjectWorkspace(activeProjectId)
    }
  }, [activeProjectId, ensureProjectWorkspace])

  const [dragOverZone, setDragOverZone] = useState<PanelZone | null>(null)
  const [draggingPanelId, setDraggingPanelId] = useState<string | null>(null)
  const draggingPanelIdRef = useRef<string | null>(null)
  const verticalGroupRef = useRef<ImperativePanelGroupHandle>(null)
  const horizontalGroupRef = useRef<ImperativePanelGroupHandle>(null)
  const leftPanelRef = useRef<ImperativePanelHandle>(null)

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
      if (!activeProjectId || sizes.length < 1) return
      const current = useWorkspaceStore.getState().workspaces[activeProjectId]?.layout
      if (!current) return

      const workspaceState = useWorkspaceStore.getState().workspaces[activeProjectId]
      const leftCollapsed = workspaceState?.layout.leftCollapsed ?? false
      const hasLeftPanel =
        workspaceState?.panels.some((p) => p.zone === 'left') ?? false
      const hasLeftVisible = hasLeftPanel && !leftCollapsed
      const hasRight =
        (workspaceState?.panels.filter((p) => p.zone === 'right').length ?? 0) > 0

      // Do not persist sizes while Files is collapsed — keep the last open width.
      if (leftCollapsed) return

      if (hasLeftVisible && hasRight && sizes.length >= 3) {
        const partial = {
          leftSize: clampLeftSize(sizes[0]),
          centerSize: sizes[1],
          rightSize: sizes[2]
        }
        if (!hasLayoutChange(current, partial)) return
        updateLayout(activeProjectId, partial)
        return
      }

      if (hasLeftVisible && sizes.length >= 2) {
        const partial = {
          leftSize: clampLeftSize(sizes[0]),
          centerSize: sizes[1]
        }
        if (!hasLayoutChange(current, partial)) return
        updateLayout(activeProjectId, partial)
        return
      }

      if (!hasLeftVisible && hasRight && sizes.length >= 2) {
        const partial = {
          centerSize: sizes[0],
          rightSize: sizes[1]
        }
        if (!hasLayoutChange(current, partial)) return
        updateLayout(activeProjectId, partial)
      }
    },
    [activeProjectId, updateLayout]
  )

  const leftCollapsed = workspace?.layout.leftCollapsed ?? false
  const hasLeftPanel = workspace?.panels.some((p) => p.zone === 'left') ?? false

  useEffect(() => {
    const panel = leftPanelRef.current
    if (!panel || !hasLeftPanel) return
    if (leftCollapsed) {
      panel.collapse()
      return
    }

    panel.expand()
    const savedSize = clampLeftSize(
      useWorkspaceStore.getState().workspaces[activeProjectId ?? '']?.layout.leftSize ?? 14
    )
    requestAnimationFrame(() => {
      leftPanelRef.current?.resize(savedSize)
    })
  }, [activeProjectId, hasLeftPanel, leftCollapsed])

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
  const leftSize = clampLeftSize(layout.leftSize || 14)
  const hasRight = rightPanels.length > 0
  const hasBottom = bottomPanels.length > 0

  const mainContent = (
    <PanelGroup
      ref={horizontalGroupRef}
      direction="horizontal"
      onLayout={handleHorizontalLayout}
      style={{ direction: 'ltr' }}
    >
      {hasLeftPanel && (
        <>
          <Panel
            id="files-sidebar"
            order={1}
            ref={leftPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize={leftSize}
            minSize={LEFT_MIN}
            maxSize={LEFT_MAX}
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
                view={layout.leftSidebarView ?? 'files'}
                onHide={() => toggleSidebar(activeProjectId)}
              />
            </ZoneDropArea>
          </Panel>
          <PanelResizeHandle
            disabled={!showLeftSidebar}
            className={cn('app-no-drag', !showLeftSidebar && 'resize-handle-hidden')}
          />
        </>
      )}

      <Panel
        id="workspace-center"
        order={2}
        defaultSize={showLeftSidebar ? 100 - leftSize : 100}
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
          <PanelResizeHandle className="app-no-drag" />
          <Panel
            id="diff-sidebar"
            order={3}
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
    <div className="flex min-h-0 flex-1">
      <SidebarActivityBar
        isOpen={!leftCollapsed}
        view={layout.leftSidebarView ?? 'files'}
        changesCount={changesCount}
        onSelectFiles={() => selectLeftSidebar(activeProjectId, 'files')}
        onSelectChanges={() => selectLeftSidebar(activeProjectId, 'changes')}
        onSelectAccounts={() => selectLeftSidebar(activeProjectId, 'accounts')}
      />
      <div className="min-h-0 min-w-0 flex-1">
        {hasBottom ? (
        <PanelGroup
          ref={verticalGroupRef}
          direction="vertical"
          onLayout={handleVerticalLayout}
        >
          <Panel defaultSize={layout.mainVerticalSize} minSize={30}>
            {mainContent}
          </Panel>
          <PanelResizeHandle className="h-1 bg-border transition-colors hover:bg-primary/40" />
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
    </div>
  )
}
