import { ChevronRight, Command, Terminal } from 'lucide-react'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { getCliLogo } from '@renderer/lib/cli-logos'
import type { PanelType, PanelZone } from '@shared/types'
import { ADD_PANEL_MENU_EVENT, COMMAND_PALETTE_EVENT } from '@renderer/lib/app-events'
import { ContextMenu } from '@renderer/components/ui/ContextMenu'
import { useOrchestratorContextMenu } from '@renderer/components/workspace/use-orchestrator-context-menu'
import { useRef } from 'react'
import { isMacOS } from '@renderer/lib/electron-api'

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

function LaunchRow({
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
    <button type="button" onClick={onClick} className="studio-launch-row">
      <span className="studio-launch-mark">
        {logo ? (
          <img src={logo} alt="" className="studio-launch-logo" />
        ) : (
          <Terminal className="h-4 w-4 text-primary" />
        )}
      </span>
      <span className="studio-launch-copy">
        <span className="studio-launch-name">{label}</span>
        <span className="studio-launch-role">{hint}</span>
      </span>
      <ChevronRight className="studio-launch-chevron" aria-hidden />
    </button>
  )
}

export function WorkspaceCenterEmpty(): React.JSX.Element {
  const addPanel = useWorkspaceStore((s) => s.addPanel)
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
      className="workspace-launcher studio-launcher relative flex h-full flex-col overflow-auto"
      onContextMenu={(e) => openAt(e)}
    >
      <div className="studio-launcher-content animate-fade-in">
        <div className="studio-launch-panel">
          {LAUNCHERS.map((item) => (
            <LaunchRow
              key={item.type}
              type={item.type}
              label={item.label}
              hint={item.hint}
              onClick={() => addPanel(item.type, MAIN_ZONE)}
            />
          ))}
        </div>

        <div className="studio-launch-footer">
          <span className="studio-launch-keys">
            <kbd>{isMacOS() ? '⌘' : 'Ctrl'}</kbd>
            <kbd>`</kbd>
            <span>Terminal</span>
          </span>
          <span className="studio-launch-footer-actions">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent(ADD_PANEL_MENU_EVENT))}
            >
              Panel menu
            </button>
            <button type="button" onClick={openCommandPalette}>
              <Command aria-hidden />
              Command palette
            </button>
          </span>
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
