import {
  Bot,
  Keyboard,
  Plus,
  Sparkles,
  Terminal
} from 'lucide-react'
import { AppLogo } from '@renderer/components/brand/AppLogo'
import { useActiveProject } from '@renderer/hooks/use-active-project'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { cn } from '@renderer/lib/utils'
import { CLI_LOGO_CLASS, getCliLogo } from '@renderer/lib/cli-logos'
import type { PanelZone } from '@shared/types'
import { ADD_PANEL_MENU_EVENT, COMMAND_PALETTE_EVENT } from '@renderer/lib/app-events'
import { ContextMenu } from '@renderer/components/ui/ContextMenu'
import { useOrchestratorContextMenu } from '@renderer/components/workspace/use-orchestrator-context-menu'
import { useRef } from 'react'

function ShortcutKey({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded border border-border bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
      {children}
    </kbd>
  )
}

function QuickAction({
  icon: Icon,
  logo,
  label,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>
  logo?: string | null
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-panel-bg p-3 text-left transition-all duration-150',
        'hover:border-primary/40 hover:bg-elevated hover:shadow-sm'
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-elevated">
        {logo ? (
          <img src={logo} alt="" className={CLI_LOGO_CLASS} />
        ) : (
          <Icon className="h-4 w-4 text-text-muted" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-text-primary">{label}</p>
      </div>
    </button>
  )
}

const MAIN_ZONE: PanelZone = 'center'

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

  const addMainPanel = (
    type:
      | 'terminal'
      | 'claude'
      | 'cursor'
      | 'gemini'
      | 'antigravity'
      | 'codex'
      | 'git-changes'
  ): void => {
    addPanel(type, MAIN_ZONE)
  }

  return (
    <div
      ref={canvasRef}
      className="flex h-full flex-col items-center justify-center overflow-auto bg-app-bg px-6 py-10"
      onContextMenu={(e) => openAt(e)}
    >
      <div className="w-full max-w-xl animate-fade-in">
        <div className="flex flex-col items-center text-center">
          <AppLogo size="lg" />
          <h2 className="mt-5 text-base font-medium text-text-primary">
            {projectName ?? 'Your workspace'}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-text-muted">
            Open CLIs on the notebook grid. Right-click empty space to add a terminal where you
            click. Drag edges to resize — size snaps to the squares.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <QuickAction
            icon={Terminal}
            label="Add Terminal"
            onClick={() => addMainPanel('terminal')}
          />
          <QuickAction
            icon={Bot}
            logo={getCliLogo('claude')}
            label="Add Claude Code"
            onClick={() => addMainPanel('claude')}
          />
          <QuickAction
            icon={Sparkles}
            logo={getCliLogo('cursor')}
            label="Add Cursor CLI"
            onClick={() => addMainPanel('cursor')}
          />
          <QuickAction
            icon={Sparkles}
            logo={getCliLogo('gemini')}
            label="Open Gemini CLI"
            onClick={() => addMainPanel('gemini')}
          />
          <QuickAction
            icon={Sparkles}
            logo={getCliLogo('antigravity')}
            label="Open Antigravity CLI"
            onClick={() => addMainPanel('antigravity')}
          />
          <QuickAction
            icon={Sparkles}
            logo={getCliLogo('codex')}
            label="Open Codex CLI"
            onClick={() => addMainPanel('codex')}
          />
        </div>

        <div className="mt-8 rounded-xl border border-border bg-panel-bg p-4">
          <div className="flex items-center gap-2 text-text-muted">
            <Keyboard className="h-3.5 w-3.5" />
            <p className="text-[11px] font-medium uppercase tracking-wider">How to add more</p>
          </div>

          <ul className="mt-3 space-y-2.5 text-left text-xs text-text-secondary">
            <li className="flex flex-wrap items-center gap-2">
              <span>Use</span>
              <ShortcutKey>Add Panel</ShortcutKey>
              <span>top-right to open another CLI in this area</span>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent(ADD_PANEL_MENU_EVENT))}
                className="ml-auto text-[11px] text-primary hover:underline"
              >
                Open now
              </button>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span>Press</span>
              <ShortcutKey>Ctrl</ShortcutKey>
              <ShortcutKey>`</ShortcutKey>
              <span>to add a new terminal instantly</span>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span>
                Right-click empty space to add Terminal, Claude, Cursor, Gemini, Antigravity, or
                Codex at that spot
              </span>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span>Resize any terminal from its edges, even when it is the only one</span>
            </li>
          </ul>
        </div>

        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={openCommandPalette}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border border-border bg-elevated px-4 py-2 text-xs text-text-secondary transition-colors',
              'hover:border-primary/40 hover:text-text-primary'
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Browse all panels
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
