import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown } from 'lucide-react'
import {
  parseCanvasMode,
  WORKSPACE_CANVAS_LAYOUT_GROUPS,
  WORKSPACE_CANVAS_MODE_LABELS,
  WORKSPACE_CANVAS_MODE_TITLES,
  type WorkspaceCanvasMode
} from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

const GLYPH_CELLS: Record<WorkspaceCanvasMode, number> = {
  free: 1,
  tiled: 4,
  'grid-2x2': 4,
  'cols-2': 2,
  'cols-3': 3,
  'cols-4': 4,
  'rows-2': 2,
  'rows-3': 3,
  'rows-4': 4
}

function LayoutGlyph({ mode }: { mode: WorkspaceCanvasMode }): React.JSX.Element {
  const count = GLYPH_CELLS[mode]
  return (
    <span className={cn('layout-glyph', `is-${mode}`)} aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <i key={index} />
      ))}
    </span>
  )
}

export function LayoutModeMenu({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  const canvasMode = useWorkspaceStore((state) => {
    const workspace = state.getActiveWorkspace()
    return parseCanvasMode(workspace?.layout.canvasMode)
  })
  const setCanvasMode = useWorkspaceStore((state) => state.setCanvasMode)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn('status-layout-btn', canvasMode !== 'free' && 'is-on')}
          disabled={disabled}
          title="Workspace layout"
          aria-label={`Workspace layout ${WORKSPACE_CANVAS_MODE_LABELS[canvasMode]}`}
        >
          <LayoutGlyph mode={canvasMode} />
          {WORKSPACE_CANVAS_MODE_LABELS[canvasMode]}
          <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="layout-mode-menu desktop-menu"
          side="top"
          align="end"
          sideOffset={6}
          collisionPadding={8}
        >
          {WORKSPACE_CANVAS_LAYOUT_GROUPS.map((group) => (
            <DropdownMenu.Group key={group.label} className="layout-mode-group">
              <DropdownMenu.Label className="layout-mode-label">{group.label}</DropdownMenu.Label>
              <div
                className={cn(
                  'layout-mode-choices',
                  group.modes.length > 2 && 'is-compact'
                )}
              >
                {group.modes.map((mode) => {
                  const active = canvasMode === mode
                  const compact = group.modes.length > 2
                  return (
                    <DropdownMenu.Item
                      key={mode}
                      className={cn('layout-mode-choice', active && 'is-active')}
                      onSelect={() => setCanvasMode(mode)}
                      title={WORKSPACE_CANVAS_MODE_TITLES[mode]}
                    >
                      <LayoutGlyph mode={mode} />
                      <span>{compact ? WORKSPACE_CANVAS_MODE_LABELS[mode] : WORKSPACE_CANVAS_MODE_TITLES[mode]}</span>
                    </DropdownMenu.Item>
                  )
                })}
              </div>
            </DropdownMenu.Group>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
