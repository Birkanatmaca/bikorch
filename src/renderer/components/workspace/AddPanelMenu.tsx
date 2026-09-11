import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, ChevronDown } from 'lucide-react'
import { type PanelType, PANEL_TYPE_LABELS } from '@shared/types'
import { ADD_PANEL_MENU_EVENT } from '@renderer/lib/app-events'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { cn } from '@renderer/lib/utils'
import { PanelIcon } from '@renderer/components/ui/PanelIcon'
import { Button } from '@renderer/components/ui/Button'

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
  browser: 'Browser'
}

const ADDABLE_PANEL_TYPES: PanelType[] = [
  'terminal',
  'claude',
  'cursor',
  'gemini',
  'antigravity',
  'codex',
  'chatgpt',
  'claude-chat',
  'file-explorer',
  'git-changes',
  'diff',
  'logs',
  'player',
  'timer',
  'browser'
]

export { ADD_PANEL_MENU_EVENT } from '@renderer/lib/app-events'

export function AddPanelMenu(): React.JSX.Element {
  const addPanel = useWorkspaceStore((s) => s.addPanel)
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
      className="header-dropdown-menu fixed z-[10001] min-w-[200px] overflow-hidden rounded-xl py-1 shadow-2xl animate-scale-in"
      style={{ top: menuStyle.top, left: menuStyle.left }}
    >
      <p className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
        Add panel
      </p>
      {ADDABLE_PANEL_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          role="menuitem"
          onClick={() => {
            addPanel(type, type === 'chatgpt' || type === 'claude-chat' ? 'right' : 'center')
            closeMenu()
          }}
          className="menu-action flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-text-secondary"
        >
          <PanelIcon type={type} className="text-text-muted" />
          {PANEL_MENU_LABELS[type] ?? PANEL_TYPE_LABELS[type]}
        </button>
      ))}
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
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Panel
        <ChevronDown className="h-3 w-3 opacity-70" />
      </Button>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}
