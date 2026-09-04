import { Command, Plus, Terminal } from 'lucide-react'
import { AppLogo } from '@renderer/components/brand/AppLogo'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { getCliLogo } from '@renderer/lib/cli-logos'
import type { PanelType, PanelZone } from '@shared/types'
import { ADD_PANEL_MENU_EVENT, COMMAND_PALETTE_EVENT } from '@renderer/lib/app-events'
import { ContextMenu } from '@renderer/components/ui/ContextMenu'
import { useOrchestratorContextMenu } from '@renderer/components/workspace/use-orchestrator-context-menu'
import { useRef } from 'react'

const MAIN_ZONE: PanelZone = 'center'

const LAUNCHERS: Array<{
  type: Extract<PanelType, 'terminal' | 'claude' | 'cursor' | 'gemini' | 'antigravity' | 'codex'>
  label: string
  hint: string
}> = [
  { type: 'terminal', label: 'Terminal', hint: 'Shell' },
  { type: 'claude', label: 'Claude', hint: 'Code' },
  { type: 'cursor', label: 'Cursor', hint: 'Agent' },
  { type: 'gemini', label: 'Gemini', hint: 'CLI' },
  { type: 'antigravity', label: 'Antigravity', hint: 'CLI' },
  { type: 'codex', label: 'Codex', hint: 'CLI' }
]

function LaunchTile({
  type,
  label,
  hint,
  onClick
}: {
  type: (typeof LAUNCHERS)[number]['type']
  label: string
  hint: string
  onClick: () => void
}): React.JSX.Element {
  const logo = type === 'terminal' ? null : getCliLogo(type)

  return (
    <button type="button" onClick={onClick} className="cli-launch-tile group">
      <span className="cli-launch-logo-well">
        {logo ? (
          <img src={logo} alt="" className="cli-launch-logo" />
        ) : (
          <Terminal className="h-6 w-6 text-primary" />
        )}
      </span>
      <span className="mt-3 text-[13px] font-medium tracking-tight text-text-primary">{label}</span>
      <span className="mt-0.5 text-[10px] text-text-muted">{hint}</span>
    </button>
  )
}

export function WorkspaceCenterEmpty(): React.JSX.Element {
  const addPanel = useWorkspaceStore((s) => s.addPanel)
  const { projectName } = useActiveProject()
  const canvasRef = useRef<HTMLDivElement>(null)
  const { menu, groups, openAt, close } = useOrchestratorContextMenu(
    () => canvasRef.current?.getBoundingClientRect() ?? null
  )

  const openCommandPalette = (): void => {
    window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT))
  }

  return (
    <div
      ref={canvasRef}
      className="relative flex h-full flex-col items-center justify-center overflow-auto px-6 py-10"
      onContextMenu={(e) => openAt(e)}
    >
      <div className="relative w-full max-w-[560px] animate-fade-in">
        <div className="flex flex-col items-center text-center">
          <AppLogo size="lg" />
          <h2 className="mt-4 text-lg font-medium tracking-tight text-text-primary">
            {projectName ?? 'Workspace'}
          </h2>
          <p className="mt-1.5 text-[13px] text-text-muted">Choose a CLI to start this session</p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {LAUNCHERS.map((item) => (
            <LaunchTile
              key={item.type}
              type={item.type}
              label={item.label}
              hint={item.hint}
              onClick={() => addPanel(item.type, MAIN_ZONE)}
            />
          ))}
        </div>

        <div className="cli-launch-hints mt-8">
          <p>
            Right-click the canvas to place a CLI
            <span className="cli-launch-dot" />
            <kbd>Ctrl</kbd>
            <kbd>`</kbd>
            terminal
            <span className="cli-launch-dot" />
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent(ADD_PANEL_MENU_EVENT))}
            >
              Panel menu
            </button>
          </p>
        </div>

        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={openCommandPalette}
            className="inline-flex items-center gap-1.5 text-[11px] text-text-muted transition-colors hover:text-text-primary"
          >
            <Command className="h-3 w-3" />
            Command palette
            <Plus className="h-3 w-3 opacity-50" />
          </button>
        </div>
      </div>
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
