import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  allocateOrchestratorRect,
  clampOrchestratorRect,
  DEFAULT_ORCHESTRATOR_RECT,
  DEFAULT_PLAYER_RECT,
  DEFAULT_TIMER_RECT,
  floatingWidgetRect,
  isFloatingWidget,
  panelMinLimits,
  isFullBleedOrchestratorRect,
  type OrchestratorRect,
  type PanelDefinition,
  type PanelType,
  type WorkspaceLayout
} from '@shared/types'
import { isTiledWorkspace, syncGridWithPanelIds, tiledCenterPanelIds } from '@shared/workspace-grid'
import { PanelShell } from '@renderer/components/panels/PanelShell'
import { WorkspacePlayerPanel } from '@renderer/components/music/WorkspacePlayerPanel'
import { WorkspaceTimerWidget } from '@renderer/components/timer/WorkspaceTimerWidget'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { cn } from '@renderer/lib/utils'
import { FOCUS_PANEL_EVENT, focusTerminal, lockTerminalLayout, unlockTerminalLayout } from '@renderer/lib/app-events'
import { cliFrameClass, getCliChromePhase } from '@renderer/lib/cli-chrome'
import { isMacOS } from '@renderer/lib/electron-api'
import { ContextMenu } from '@renderer/components/ui/ContextMenu'
import { useOrchestratorContextMenu } from '@renderer/components/workspace/use-orchestrator-context-menu'
import { TiledWorkspace } from '@renderer/components/workspace/TiledWorkspace'

const LIVE_PANEL_TYPES: PanelType[] = [
  'terminal',
  'claude',
  'cursor',
  'gemini',
  'antigravity',
  'codex'
]

const GRID_PX = 12
const MIN_CELLS_X = 4
const MIN_CELLS_Y = 3

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface OrchestratorZoneProps {
  projectId: string
  panels: PanelDefinition[]
  layout: WorkspaceLayout
  onClose: (panelId: string) => void
}

function defaultRect(): OrchestratorRect {
  return { ...DEFAULT_ORCHESTRATOR_RECT }
}

function snapPx(value: number): number {
  return Math.round(value / GRID_PX) * GRID_PX
}

function snapRectToGrid(
  rect: OrchestratorRect,
  canvasW: number,
  canvasH: number,
  limits?: { minW?: number; minH?: number }
): OrchestratorRect {
  const canvas = { w: canvasW, h: canvasH }
  const fallback = panelMinLimits(undefined, canvas)
  const minFloor = {
    minW: limits?.minW ?? fallback.minW,
    minH: limits?.minH ?? fallback.minH
  }
  if (canvasW <= 0 || canvasH <= 0) return clampOrchestratorRect(rect, minFloor)

  const gridMinW = (MIN_CELLS_X * GRID_PX / canvasW) * 100
  const gridMinH = (MIN_CELLS_Y * GRID_PX / canvasH) * 100
  const minW = Math.max(gridMinW, minFloor.minW)
  const minH = Math.max(gridMinH, minFloor.minH)

  const left = snapPx((rect.x / 100) * canvasW)
  const top = snapPx((rect.y / 100) * canvasH)
  let right = snapPx(((rect.x + rect.w) / 100) * canvasW)
  let bottom = snapPx(((rect.y + rect.h) / 100) * canvasH)

  right = Math.max(right, left + (minW / 100) * canvasW)
  bottom = Math.max(bottom, top + (minH / 100) * canvasH)
  right = Math.min(right, snapPx(canvasW))
  bottom = Math.min(bottom, snapPx(canvasH))

  return clampOrchestratorRect(
    {
      x: (left / canvasW) * 100,
      y: (top / canvasH) * 100,
      w: Math.max(minW, ((right - left) / canvasW) * 100),
      h: Math.max(minH, ((bottom - top) / canvasH) * 100)
    },
    { minW, minH }
  )
}

function applyResize(
  start: OrchestratorRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  minW: number,
  minH: number
): OrchestratorRect {
  let { x, y, w, h } = start

  if (edge.includes('e')) {
    w = Math.max(minW, start.w + dx)
  }
  if (edge.includes('w')) {
    const nextW = Math.max(minW, start.w - dx)
    x = start.x + start.w - nextW
    w = nextW
  }
  if (edge.includes('s')) {
    h = Math.max(minH, start.h + dy)
  }
  if (edge.includes('n')) {
    const nextH = Math.max(minH, start.h - dy)
    y = start.y + start.h - nextH
    h = nextH
  }

  return { x, y, w, h }
}

const EDGE_CURSOR: Record<ResizeEdge, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize'
}

function ResizeHandles({
  onStart
}: {
  onStart: (edge: ResizeEdge, e: React.PointerEvent) => void
}): React.JSX.Element {
  const handle = (edge: ResizeEdge, className: string): React.JSX.Element => (
    <div
      className={cn('absolute z-20', className)}
      data-resize-handle=""
      style={{ cursor: EDGE_CURSOR[edge] }}
      onPointerDown={(e) => onStart(edge, e)}
    />
  )

  return (
    <>
      {handle('n', 'left-3 right-3 top-0 h-2')}
      {handle('s', 'left-3 right-3 bottom-0 h-2')}
      {handle('w', 'top-3 bottom-3 left-0 w-2')}
      {handle('e', 'top-3 bottom-3 right-0 w-2')}
      {handle('nw', 'left-0 top-0 h-3 w-3')}
      {handle('ne', 'right-0 top-0 h-3 w-3')}
      {handle('sw', 'bottom-0 left-0 h-3 w-3')}
      {handle('se', 'bottom-0 right-0 h-3 w-3')}
    </>
  )
}

function OrchestratorWindow({
  panel,
  rect,
  z,
  onFocus,
  onClose,
  onMoveStart,
  onResizeStart,
  onContextMenu,
  live,
  active
}: {
  panel: PanelDefinition
  rect: OrchestratorRect
  z: number
  onFocus: () => void
  onClose: () => void
  onMoveStart: (e: React.PointerEvent) => void
  onResizeStart: (edge: ResizeEdge, e: React.PointerEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  live: boolean
  active: boolean
}): React.JSX.Element {
  const isWidget = isFloatingWidget(panel.type)
  const status = useTerminalStore((s) => s.sessions[panel.id])
  const phase = getCliChromePhase(panel.type, status)
  const showChrome = !isWidget && LIVE_PANEL_TYPES.includes(panel.type) && phase !== 'off'
  const isMac = isMacOS()

  return (
    <div
      className="absolute overflow-visible"
      style={{
        left: `${rect.x}%`,
        top: `${rect.y}%`,
        width: `${rect.w}%`,
        height: `${rect.h}%`,
        zIndex: z,
        transition: live
          ? 'none'
          : 'left 140ms ease-out, top 140ms ease-out, width 140ms ease-out, height 140ms ease-out'
      }}
      onPointerDown={(e) => {
        onFocus()
        if (isWidget) return
        const target = e.target as HTMLElement
        if (target.closest('button, header, [data-resize-handle]')) return
        focusTerminal(panel.id)
      }}
      onContextMenu={onContextMenu}
      onFocusCapture={onFocus}
    >
      {isWidget ? (
        <div className={cn('relative h-full', panel.type === 'player' ? 'music-player-float' : 'timer-widget-float')}>
          {panel.type === 'timer' ? (
            <WorkspaceTimerWidget
              onMoveStart={(event) => {
                if ((event.target as HTMLElement).closest('button, input')) return
                onMoveStart(event)
              }}
              onClose={onClose}
            />
          ) : (
            <WorkspacePlayerPanel
              onMoveStart={(event) => {
                if ((event.target as HTMLElement).closest('button, input, .music-player-seek')) return
                onMoveStart(event)
              }}
              onClose={onClose}
            />
          )}
          {panel.type === 'timer' ? <ResizeHandles onStart={onResizeStart} /> : null}
        </div>
      ) : (
        <div
          className={cn(
            'workstation-window relative h-full overflow-hidden border bg-panel-bg',
            isMac ? 'orchestrator-window-macos' : 'rounded-md shadow-lg shadow-black/25',
            showChrome ? cliFrameClass(phase) : 'border-border',
            !active && isMac && 'orchestrator-window-macos-inactive'
          )}
          data-active={active}
          data-interacting={live}
        >
          <PanelShell
            id={panel.id}
            type={panel.type}
            title={panel.title}
            onClose={onClose}
            launchMode={panel.launchMode}
            accountId={panel.accountId}
            draggable={false}
            flush
            windowActive={active}
            onHeaderPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('button, .mac-traffic-lights')) return
              onMoveStart(e)
            }}
          />
        </div>
      )}
      <ResizeHandles onStart={onResizeStart} />
    </div>
  )
}

export function OrchestratorZone({
  projectId,
  panels,
  layout,
  onClose
}: OrchestratorZoneProps): React.JSX.Element {
  const updateCenterPanelRect = useWorkspaceStore((s) => s.updateCenterPanelRect)
  const updateLayout = useWorkspaceStore((s) => s.updateLayout)
  const canvasRef = useRef<HTMLDivElement>(null)
  const { menu, groups, openAt, close } = useOrchestratorContextMenu(
    () => canvasRef.current?.getBoundingClientRect() ?? null,
    isTiledWorkspace(layout)
  )
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const previousPanelIds = useRef(new Set(panels.map((panel) => panel.id)))
  const [previewRects, setPreviewRects] = useState<Record<string, OrchestratorRect>>({})
  const previewRectsRef = useRef<Record<string, OrchestratorRect>>({})
  const dragFrameRef = useRef<number | null>(null)
  const dragRef = useRef<{
    panelId: string
    mode: 'move' | ResizeEdge
    start: OrchestratorRect
    pointerX: number
    pointerY: number
    panelType?: PanelType
  } | null>(null)

  const rects = layout.centerPanelRects ?? {}
  const tiled = isTiledWorkspace(layout)
  const tilePanels = panels.filter((panel) => !isFloatingWidget(panel.type))
  const widgetPanels = panels.filter((panel) => isFloatingWidget(panel.type))

  useEffect(() => {
    if (!tiled) return
    const ids = tiledCenterPanelIds(panels)
    const next = syncGridWithPanelIds(layout.centerGrid ?? null, ids)
    if (JSON.stringify(next) === JSON.stringify(layout.centerGrid ?? null)) return
    updateLayout(projectId, { centerGrid: next })
  }, [layout.centerGrid, panels, projectId, tiled, updateLayout])

  useEffect(() => {
    const addedPanel = panels.filter((panel) => !previousPanelIds.current.has(panel.id)).at(-1)
    previousPanelIds.current = new Set(panels.map((panel) => panel.id))
    if (addedPanel) setFocusedId(addedPanel.id)
  }, [panels])

  useEffect(() => {
    const onFocusPanel = (event: Event): void => {
      const panelId = (event as CustomEvent<string>).detail
      if (typeof panelId === 'string' && panels.some((panel) => panel.id === panelId)) {
        setFocusedId(panelId)
      }
    }
    window.addEventListener(FOCUS_PANEL_EVENT, onFocusPanel)
    return () => window.removeEventListener(FOCUS_PANEL_EVENT, onFocusPanel)
  }, [panels])

  useEffect(() => {
    const next = { ...rects }
    let changed = false

    if (panels.length === 1) {
      const only = panels[0]
      const current = next[only.id]
      if (current && isFullBleedOrchestratorRect(current)) {
        next[only.id] = isFloatingWidget(only.type)
          ? { ...(only.type === 'timer' ? DEFAULT_TIMER_RECT : DEFAULT_PLAYER_RECT) }
          : { ...DEFAULT_ORCHESTRATOR_RECT }
        changed = true
      }
    }

    for (const panel of panels) {
      if (!isFloatingWidget(panel.type)) continue
      const current = next[panel.id]
      if (current && current.w >= 50 && current.h >= 50) {
        next[panel.id] = floatingWidgetRect(panel.type)
        changed = true
      }
    }

    const missing = panels.filter((panel) => !next[panel.id])
    if (missing.length > 0) {
      const placed: OrchestratorRect[] = panels
        .filter((panel) => next[panel.id])
        .map((panel) => next[panel.id])

      for (const panel of missing) {
        if (isFloatingWidget(panel.type)) {
          next[panel.id] = floatingWidgetRect(panel.type)
          placed.push(next[panel.id])
          changed = true
          continue
        }
        const { next: allocated, shrinkFirst } = allocateOrchestratorRect(placed)
        if (shrinkFirst && panels[0] && !isFloatingWidget(panels[0].type)) {
          next[panels[0].id] = shrinkFirst
        }
        next[panel.id] = allocated
        placed.push(allocated)
        changed = true
      }
    }

    if (changed) {
      updateLayout(projectId, { centerPanelRects: next })
    }
  }, [panels, projectId, rects, updateLayout])

  const getRect = useCallback(
    (panelId: string): OrchestratorRect => {
      const live = previewRects[panelId] ?? rects[panelId]
      if (live) return live
      const panel = panels.find((item) => item.id === panelId)
      return panel && isFloatingWidget(panel.type)
        ? floatingWidgetRect(panel.type)
        : defaultRect()
    },
    [panels, previewRects, rects]
  )

  const canvasSize = useCallback((): { w: number; h: number } => {
    const box = canvasRef.current?.getBoundingClientRect()
    return { w: box?.width ?? 0, h: box?.height ?? 0 }
  }, [])

  const toDeltaPercent = useCallback((clientX: number, clientY: number) => {
    const { w, h } = canvasSize()
    const drag = dragRef.current
    if (!drag || w === 0 || h === 0) return { dx: 0, dy: 0 }
    return {
      dx: ((clientX - drag.pointerX) / w) * 100,
      dy: ((clientY - drag.pointerY) / h) * 100
    }
  }, [canvasSize])

  const beginInteraction = useCallback(
    (panelId: string, mode: 'move' | ResizeEdge, e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      setFocusedId(panelId)
      const start = getRect(panelId)
      const widget = panels.find((panel) => panel.id === panelId)
      dragRef.current = {
        panelId,
        mode,
        start,
        pointerX: e.clientX,
        pointerY: e.clientY,
        panelType: widget?.type
      }
      previewRectsRef.current = { [panelId]: start }
      setPreviewRects({ [panelId]: start })
      lockTerminalLayout(panelId)
    },
    [getRect, panels]
  )

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const { dx, dy } = toDeltaPercent(e.clientX, e.clientY)
      const canvas = canvasSize()
      const limits = panelMinLimits(drag.panelType, canvas)
      const next =
        drag.mode === 'move'
          ? clampOrchestratorRect(
              {
                ...drag.start,
                x: drag.start.x + dx,
                y: drag.start.y + dy
              },
              limits
            )
          : clampOrchestratorRect(
              applyResize(drag.start, drag.mode, dx, dy, limits.minW, limits.minH),
              limits
            )

      previewRectsRef.current = { [drag.panelId]: next }
      if (dragFrameRef.current !== null) return
      dragFrameRef.current = requestAnimationFrame(() => {
        dragFrameRef.current = null
        setPreviewRects({ ...previewRectsRef.current })
      })
    }

    const handlePointerUp = (): void => {
      const drag = dragRef.current
      dragRef.current = null
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current)
        dragFrameRef.current = null
      }
      if (!drag) return

      const live = previewRectsRef.current[drag.panelId]
      const { w, h } = canvasSize()
      if (live) {
        const limits = panelMinLimits(drag.panelType, { w, h })
        updateCenterPanelRect(drag.panelId, snapRectToGrid(live, w, h, limits))
      }
      previewRectsRef.current = {}
      setPreviewRects({})
      unlockTerminalLayout(drag.panelId)
      if (!isFloatingWidget(drag.panelType)) focusTerminal(drag.panelId)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      const drag = dragRef.current
      if (drag) unlockTerminalLayout(drag.panelId)
    }
  }, [canvasSize, toDeltaPercent, updateCenterPanelRect])

  const activePanelId = panels.some((panel) => panel.id === focusedId)
    ? focusedId
    : panels.at(-1)?.id

  const windows = useMemo(
    () =>
      (tiled ? widgetPanels : panels).map((panel, index) => {
        const rect = getRect(panel.id)
        const focused = panel.id === activePanelId
        const z = isFloatingWidget(panel.type) ? (focused ? 46 : 32) : focused ? 40 : 10 + index
        return { panel, rect, z }
      }),
    [activePanelId, getRect, panels, tiled, widgetPanels]
  )

  const isEditing = Object.keys(previewRects).length > 0

  if (panels.length === 0) {
    return <div className="h-full bg-app-bg" />
  }

  return (
    <div
      ref={canvasRef}
      className={cn('workstation-canvas relative h-full min-h-0 bg-app-bg', tiled && 'is-tiled')}
      onContextMenu={(e) => openAt(e)}
    >
      {!tiled && (
        <div
          className={cn(
            'orchestrator-grid pointer-events-none absolute inset-0',
            isEditing && 'orchestrator-grid-active'
          )}
          aria-hidden
        />
      )}
      {tiled && (
        <TiledWorkspace
          panels={tilePanels}
          grid={layout.centerGrid ?? null}
          focusedId={activePanelId ?? null}
          onFocus={setFocusedId}
          onClose={onClose}
          onContextMenu={(event, panelId) => openAt(event, panelId)}
        />
      )}
      {windows.map(({ panel, rect, z }) => (
        <OrchestratorWindow
          key={panel.id}
          panel={panel}
          rect={rect}
          z={z}
          onFocus={() => setFocusedId(panel.id)}
          onClose={() => onClose(panel.id)}
          onMoveStart={(e) => beginInteraction(panel.id, 'move', e)}
          onResizeStart={(edge, e) => beginInteraction(panel.id, edge, e)}
          onContextMenu={(e) => openAt(e, panel.id)}
          live={previewRects[panel.id] !== undefined}
          active={activePanelId === panel.id}
        />
      ))}
      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        groups={groups}
        onClose={close}
      />
    </div>
  )
}

export type { OrchestratorZoneProps }
