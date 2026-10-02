import { Bot, ChevronRight, Command, RefreshCw, Terminal } from 'lucide-react'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { getCliLogo } from '@renderer/lib/cli-logos'
import type { PanelType, PanelZone } from '@shared/types'
import { ADD_PANEL_MENU_EVENT, COMMAND_PALETTE_EVENT, OPEN_MANAGER_EVENT } from '@renderer/lib/app-events'
import { ContextMenu } from '@renderer/components/ui/ContextMenu'
import { useOrchestratorContextMenu } from '@renderer/components/workspace/use-orchestrator-context-menu'
import { useRef, useState } from 'react'
import { isMacOS } from '@renderer/lib/electron-api'
import { useCliStore } from '@renderer/stores/cli-store'
import { useAiAccountsStore } from '@renderer/stores/ai-accounts-store'
import { useCliDetection } from '@renderer/hooks/use-cli-detection'
import { CliInstallButton } from '@renderer/components/accounts/CliInstallButton'
import { openInstalledCli } from '@renderer/lib/cli-sign-in'
import type { CliUsageKind } from '@shared/contracts/usage'

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
  disabled,
  missing,
  onClick
}: {
  type: (typeof LAUNCHERS)[number]['type']
  label: string
  hint: string
  disabled: boolean
  missing: boolean
  onClick: () => void
}): React.JSX.Element {
  const logo = type === 'terminal' ? null : getCliLogo(type)

  return (
    <div className="studio-launch-entry" data-cli-kind={type}>
      <button type="button" onClick={onClick} disabled={disabled} className="studio-launch-row">
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
      {missing && type !== 'terminal' && <CliInstallButton kind={type} />}
    </div>
  )
}

export function WorkspaceCenterEmpty(): React.JSX.Element {
  useCliDetection()
  const addPanel = useWorkspaceStore((s) => s.addPanel)
  const installedByKind = useCliStore((s) => s.installedByKind)
  const errorsByKind = useCliStore((s) => s.errorsByKind)
  const installingKind = useCliStore((s) => s.installingKind)
  const accounts = useAiAccountsStore((s) => s.accounts)
  const [launchingKind, setLaunchingKind] = useState<CliUsageKind | null>(null)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const { menu, groups, openAt, close } = useOrchestratorContextMenu(
    () => canvasRef.current?.getBoundingClientRect() ?? null
  )

  const openCommandPalette = (): void => {
    window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT))
  }

  const launchCli = async (kind: CliUsageKind): Promise<void> => {
    if (launchingKind) return
    setLaunchingKind(kind)
    setLaunchError(null)
    try { await openInstalledCli(kind) }
    catch (error) { setLaunchError(error instanceof Error ? error.message : 'Could not open CLI') }
    finally { setLaunchingKind(null) }
  }

  return (
    <div
      ref={canvasRef}
      className="workspace-launcher studio-launcher relative flex h-full flex-col overflow-auto"
      onContextMenu={(e) => openAt(e)}
    >
      <div className="studio-launcher-content animate-fade-in">
        <div className="studio-launch-intro">
          <span>WORKSPACE</span>
          <h1>Work with your agents</h1>
          <p>Open an agent or terminal in this project. Review its work in Agent Work & Changes.</p>
        </div>
        <div className="studio-launch-panel">
          {LAUNCHERS.map((item) => {
            const installed = item.type === 'terminal' ? true : installedByKind[item.type]
            const hint = item.type === 'terminal' ? item.hint
              : installingKind === item.type ? 'Installing…'
                : installed === undefined ? errorsByKind[item.type] ? 'Check failed' : 'Checking…'
                  : installed === false ? 'Not installed'
                    : launchingKind === item.type ? 'Opening…'
                      : accounts.some((account) => account.kind === item.type && account.profileReady) ? 'Installed · Open' : 'Installed · Sign in'
            return (
              <LaunchRow
                key={item.type}
                type={item.type}
                label={item.label}
                hint={hint}
                disabled={item.type !== 'terminal' && (installed !== true || installingKind !== null || launchingKind !== null)}
                missing={installed === false}
                onClick={() => item.type === 'terminal' ? addPanel(item.type, MAIN_ZONE) : void launchCli(item.type)}
              />
            )
          })}
        </div>
        {(launchError || Object.values(errorsByKind).some(Boolean)) && (
          <div className="studio-cli-errors" role="alert">
            {launchError && <p>{launchError}</p>}
            {Object.entries(errorsByKind).map(([kind, error]) => error ? <p key={kind}>{error}</p> : null)}
            <button type="button" onClick={() => { setLaunchError(null); void useCliStore.getState().refresh() }}>
              <RefreshCw className="h-3 w-3" aria-hidden /> Check again
            </button>
          </div>
        )}

        <button
          type="button"
          className="studio-manager-launch"
          onClick={() => window.dispatchEvent(new Event(OPEN_MANAGER_EVENT))}
        >
          <span className="studio-manager-launch-icon"><Bot className="h-4 w-4" aria-hidden /></span>
          <span><strong>Manager</strong><small>Let Bikorch coordinate your agents for you.</small></span>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>

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
