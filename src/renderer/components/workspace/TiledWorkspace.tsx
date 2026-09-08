import { useMemo, useRef, useState } from 'react'
import {
  Panel,
  PanelGroup,
  PanelResizeHandle
} from 'react-resizable-panels'
import type {
  PanelDefinition,
  PanelType,
  WorkspaceGridNode
} from '@shared/types'
import { buildEqualGrid } from '@shared/workspace-grid'
import { PanelShell } from '@renderer/components/panels/PanelShell'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { cn } from '@renderer/lib/utils'
import { cliFrameClass, getCliChromePhase } from '@renderer/lib/cli-chrome'
import { isMacOS } from '@renderer/lib/electron-api'
import { focusTerminal } from '@renderer/lib/app-events'

const LIVE_PANEL_TYPES: PanelType[] = [
  'terminal',
  'claude',
  'cursor',
  'gemini',
  'antigravity',
  'codex'
]

const TILE_DRAG = 'application/x-bikorch-tile'

interface TiledWorkspaceProps {
  panels: PanelDefinition[]
  grid: WorkspaceGridNode | null
  focusedId: string | null
  onFocus: (panelId: string) => void
  onClose: (panelId: string) => void
  onContextMenu: (event: React.MouseEvent, panelId: string) => void
}

function TiledWindow({
  panel,
  active,
  onFocus,
  onClose,
  onContextMenu
}: {
  panel: PanelDefinition
  active: boolean
  onFocus: () => void
  onClose: () => void
  onContextMenu: (event: React.MouseEvent) => void
}): React.JSX.Element {
  const status = useTerminalStore((s) => s.sessions[panel.id])
  const phase = getCliChromePhase(panel.type, status)
  const showChrome = LIVE_PANEL_TYPES.includes(panel.type) && phase !== 'off'
  const isMac = isMacOS()
  const swapTiledPanels = useWorkspaceStore((s) => s.swapTiledPanels)
  const [dropOver, setDropOver] = useState(false)

  return (
    <div
      className={cn('tiled-cell', dropOver && 'is-drop')}
      onPointerDown={() => {
        onFocus()
        focusTerminal(panel.id)
      }}
      onContextMenu={onContextMenu}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes(TILE_DRAG)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        setDropOver(true)
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setDropOver(false)
        const sourceId = event.dataTransfer.getData(TILE_DRAG)
        if (sourceId && sourceId !== panel.id) swapTiledPanels(sourceId, panel.id)
      }}
    >
      <div
        className={cn(
          'workstation-window relative h-full overflow-hidden border bg-panel-bg',
          isMac ? 'orchestrator-window-macos' : 'rounded-md shadow-lg shadow-black/25',
          showChrome ? cliFrameClass(phase) : 'border-border',
          !active && isMac && 'orchestrator-window-macos-inactive'
        )}
        data-active={active}
      >
        <PanelShell
          id={panel.id}
          type={panel.type}
          title={panel.title}
          onClose={onClose}
          launchMode={panel.launchMode}
          accountId={panel.accountId}
          draggable
          flush
          windowActive={active}
          onDragStart={(event) => {
            event.dataTransfer.setData(TILE_DRAG, panel.id)
            event.dataTransfer.effectAllowed = 'move'
          }}
        />
        {showChrome && phase === 'busy' && <div className="cli-busy-wash" aria-hidden />}
      </div>
    </div>
  )
}

function GridBranch({
  node,
  path,
  panelsById,
  focusedId,
  onFocus,
  onClose,
  onContextMenu
}: {
  node: WorkspaceGridNode
  path: number[]
  panelsById: Map<string, PanelDefinition>
  focusedId: string | null
  onFocus: (panelId: string) => void
  onClose: (panelId: string) => void
  onContextMenu: (event: React.MouseEvent, panelId: string) => void
}): React.JSX.Element | null {
  const updateTiledSplitSizes = useWorkspaceStore((s) => s.updateTiledSplitSizes)
  const sizesRef = useRef<[number, number]>(node.type === 'split' ? node.sizes : [50, 50])

  if (node.type === 'leaf') {
    const panel = panelsById.get(node.panelId)
    if (!panel) return null
    return (
      <TiledWindow
        panel={panel}
        active={focusedId === panel.id}
        onFocus={() => onFocus(panel.id)}
        onClose={() => onClose(panel.id)}
        onContextMenu={(event) => onContextMenu(event, panel.id)}
      />
    )
  }

  sizesRef.current = node.sizes
  const groupDirection = node.direction === 'vertical' ? 'horizontal' : 'vertical'

  return (
    <PanelGroup
      direction={groupDirection}
      className="tiled-branch"
      onLayout={(sizes) => {
        if (sizes.length >= 2) sizesRef.current = [sizes[0], sizes[1]]
      }}
    >
      <Panel
        id={`tile-${path.join('-') || 'root'}-0`}
        defaultSize={node.sizes[0]}
        minSize={14}
        order={1}
      >
        <GridBranch
          node={node.children[0]}
          path={[...path, 0]}
          panelsById={panelsById}
          focusedId={focusedId}
          onFocus={onFocus}
          onClose={onClose}
          onContextMenu={onContextMenu}
        />
      </Panel>
      <PanelResizeHandle
        className="tiled-split-handle app-no-drag"
        onDragging={(dragging) => {
          if (dragging) return
          updateTiledSplitSizes(path, sizesRef.current)
        }}
      />
      <Panel
        id={`tile-${path.join('-') || 'root'}-1`}
        defaultSize={node.sizes[1]}
        minSize={14}
        order={2}
      >
        <GridBranch
          node={node.children[1]}
          path={[...path, 1]}
          panelsById={panelsById}
          focusedId={focusedId}
          onFocus={onFocus}
          onClose={onClose}
          onContextMenu={onContextMenu}
        />
      </Panel>
    </PanelGroup>
  )
}

export function TiledWorkspace({
  panels,
  grid,
  focusedId,
  onFocus,
  onClose,
  onContextMenu
}: TiledWorkspaceProps): React.JSX.Element {
  const panelsById = useMemo(
    () => new Map(panels.map((panel) => [panel.id, panel])),
    [panels]
  )
  const tree = grid ?? buildEqualGrid(panels.map((panel) => panel.id))

  if (!tree) {
    return <div className="tiled-workspace" />
  }

  return (
    <div className="tiled-workspace">
      <GridBranch
        node={tree}
        path={[]}
        panelsById={panelsById}
        focusedId={focusedId}
        onFocus={onFocus}
        onClose={onClose}
        onContextMenu={onContextMenu}
      />
    </div>
  )
}
