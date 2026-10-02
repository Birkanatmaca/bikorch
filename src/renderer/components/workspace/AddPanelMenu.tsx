import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, ChevronDown } from 'lucide-react'
import { type PanelType, PANEL_TYPE_LABELS } from '@shared/types'
import { ADD_PANEL_MENU_EVENT } from '@renderer/lib/app-events'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { cn } from '@renderer/lib/utils'
import { PanelIcon } from '@renderer/components/ui/PanelIcon'
import { Button } from '@renderer/components/ui/Button'
import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import type { CliUsageKind } from '@shared/contracts/usage'
import { useCliDetection } from '@renderer/hooks/use-cli-detection'
import { useCliStore } from '@renderer/stores/cli-store'
import { CliInstallButton } from '@renderer/components/accounts/CliInstallButton'
import { openInstalledCli } from '@renderer/lib/cli-sign-in'

const PANEL_MENU_LABELS: Partial<Record<PanelType, string>> = {
  terminal: 'Terminal',
  claude: 'Claude',
  cursor: 'Cursor',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  codex: 'Codex',
  chatgpt: 'ChatGPT',
  'claude-chat': 'Claude Chat',
  player: 'Player',
  timer: 'Timer',
  browser: 'Browser',
  'mobile-preview': 'Mobile Preview',
  'ios-preview': 'iOS Device',
  'android-preview': 'Android Device'
}

const PANEL_GROUPS: Array<{ label: string; types: PanelType[] }> = [
  { label: 'Agents & terminal', types: ['terminal', 'claude', 'cursor', 'gemini', 'antigravity', 'codex', 'chatgpt', 'claude-chat'] },
  { label: 'Workspace', types: ['file-explorer', 'git-changes', 'diff', 'logs', 'browser', 'ios-preview', 'android-preview'] },
  { label: 'Tools', types: ['player', 'timer'] }
]

export { ADD_PANEL_MENU_EVENT } from '@renderer/lib/app-events'

export function AddPanelMenu(): React.JSX.Element {
  useCliDetection()
  const addPanel = useWorkspaceStore((s) => s.addPanel)
  const installedByKind = useCliStore((s) => s.installedByKind)
  const installingKind = useCliStore((s) => s.installingKind)
  const errorsByKind = useCliStore((s) => s.errorsByKind)
  const [error, setError] = useState<string | null>(null)
  const [launchingKind, setLaunchingKind] = useState<CliUsageKind | null>(null)
  const launchInFlight = useRef(false)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updateMenuPosition = (): void => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const menuWidth = 200
    setMenuStyle({
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - menuWidth)
    })
  }

  const openMenu = (): void => {
    setError(null)
    updateMenuPosition()
    setOpen(true)
  }

  const closeMenu = (): void => {
    setOpen(false)
  }

  useLayoutEffect(() => {
    if (!open) return
    updateMenuPosition()
  }, [open])

  useEffect(() => {
    const handleOpenRequest = (): void => {
      openMenu()
    }

    window.addEventListener(ADD_PANEL_MENU_EVENT, handleOpenRequest)
    return () => window.removeEventListener(ADD_PANEL_MENU_EVENT, handleOpenRequest)
  }, [])

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent): void => {
      const target = e.target as Node
      if (
        menuRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return
      }
      closeMenu()
    }

    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu()
    }

    const handleResize = (): void => {
      updateMenuPosition()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('resize', handleResize)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('resize', handleResize)
    }
  }, [open])

  const menu = open && menuStyle ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Add panel"
      className="header-dropdown-menu fixed z-[10001] max-h-[calc(100vh-64px)] min-w-[200px] overflow-y-auto rounded-xl py-1 shadow-2xl animate-scale-in"
      style={{ top: menuStyle.top, left: menuStyle.left }}
    >
      {PANEL_GROUPS.map(({ label, types }) => (
        <div key={label} className="panel-menu-group" role="group" aria-label={label}>
          <p className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">{label}</p>
          {types.map((type) => {
            const kind = AI_ACCOUNT_KINDS.includes(type as CliUsageKind) ? type as CliUsageKind : null
            const installed = kind ? installedByKind[kind] : true
            return (
              <div key={type} className="panel-menu-cli-option" data-cli-kind={type}>
                <button
                  type="button"
                  role="menuitem"
                  disabled={installed !== true || (kind !== null && (installingKind !== null || launchingKind !== null))}
                  onClick={() => {
                    if (kind) {
                      if (launchInFlight.current) return
                      launchInFlight.current = true
                      setLaunchingKind(kind)
                      void openInstalledCli(kind).then(closeMenu)
                        .catch((failure) => setError(failure instanceof Error ? failure.message : 'Could not open CLI'))
                        .finally(() => { launchInFlight.current = false; setLaunchingKind(null) })
                      return
                    }
                    addPanel(type, type === 'chatgpt' || type === 'claude-chat' ? 'right' : 'center')
                    closeMenu()
                  }}
                  className="menu-action flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-text-secondary"
                >
                  <PanelIcon type={type} className="text-text-muted" />
                  {PANEL_MENU_LABELS[type] ?? PANEL_TYPE_LABELS[type]}
                  {kind && <span className="panel-menu-cli-status">{launchingKind === kind ? 'Opening…' : installingKind === kind ? 'Installing…' : installed === false ? 'Missing' : installed === undefined ? 'Checking…' : ''}</span>}
                </button>
                {kind && installed === false && <CliInstallButton kind={kind} />}
                {kind && errorsByKind[kind] && <p className="cli-kind-error" role="alert">{errorsByKind[kind]}</p>}
              </div>
            )
          })}
        </div>
      ))}
      {error && <p className="cli-kind-error" role="alert">{error}</p>}
    </div>
  ) : null

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="primary"
        onClick={() => (open ? closeMenu() : openMenu())}
        className={cn(
          'app-no-drag',
          open && 'is-pressed'
        )}
        title="Add panel"
        aria-label="Add panel"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="header-action-label">Add Panel</span>
        <ChevronDown className="header-action-chevron h-3 w-3 opacity-70" />
      </Button>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}
