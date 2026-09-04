import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/utils'
import { useOpenProject } from '@renderer/hooks/use-open-project'
import { useHasOpenFolder } from '@renderer/hooks/use-has-open-folder'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

interface MenuItem {
  label: string
  shortcut?: string
  disabled?: boolean
  action?: () => void
}

interface MenuDefinition {
  label: string
  items: MenuItem[]
}

interface MenuBarProps {
  onCommandPalette?: () => void
  className?: string
}

function MenuDropdown({
  menu,
  open,
  onToggle,
  onClose
}: {
  menu: MenuDefinition
  open: boolean
  onToggle: () => void
  onClose: () => void
}): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number } | null>(null)

  const updateMenuPosition = (): void => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const menuWidth = 220
    const left = Math.min(rect.left, window.innerWidth - menuWidth - 8)
    setMenuStyle({
      top: rect.bottom + 2,
      left: Math.max(8, left)
    })
  }

  useLayoutEffect(() => {
    if (!open) return
    updateMenuPosition()
  }, [open])

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent): void => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      onClose()
    }

    const handleReposition = (): void => {
      updateMenuPosition()
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [open, onClose])

  const dropdown =
    open && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="header-dropdown-menu app-no-drag fixed z-[10001] min-w-[220px] overflow-hidden rounded-xl py-1 shadow-2xl animate-scale-in"
            style={{ top: menuStyle.top, left: menuStyle.left }}
          >
            {menu.items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (!item.disabled && item.action) {
                    item.action()
                    onClose()
                  }
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs transition-colors',
                  item.disabled
                    ? 'cursor-not-allowed text-text-muted/50'
                    : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                )}
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="font-mono text-[10px] text-text-muted">{item.shortcut}</span>
                )}
              </button>
            ))}
          </div>,
          document.body
        )
      : null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'app-no-drag rounded px-2 py-0.5 text-xs text-text-secondary transition-colors',
          open ? 'bg-hover text-text-primary' : 'hover:bg-hover hover:text-text-primary'
        )}
      >
        {menu.label}
      </button>
      {dropdown}
    </>
  )
}

export function MenuBar({ onCommandPalette, className }: MenuBarProps): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const { openFolderPicker } = useOpenProject()
  const addPanel = useWorkspaceStore((s) => s.addPanel)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar)
  const hasOpenFolder = useHasOpenFolder()

  const menus: MenuDefinition[] = [
    {
      label: 'File',
      items: [
        {
          label: 'Open Folder...',
          shortcut: 'Ctrl+O',
          action: () => void openFolderPicker()
        },
        {
          label: 'New Project',
          shortcut: 'Ctrl+N',
          action: () => void openFolderPicker({ forceNew: true })
        },
        { label: 'Save Workspace', disabled: true },
        { label: 'Close Window', action: () => void window.api.window.close() }
      ]
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', disabled: true },
        { label: 'Redo', shortcut: 'Ctrl+Y', disabled: true },
        { label: 'Cut', shortcut: 'Ctrl+X', disabled: true },
        { label: 'Copy', shortcut: 'Ctrl+C', disabled: true },
        { label: 'Paste', shortcut: 'Ctrl+V', disabled: true }
      ]
    },
    {
      label: 'Selection',
      items: [
        { label: 'Select All', shortcut: 'Ctrl+A', disabled: true },
        { label: 'Expand Selection', disabled: true },
        { label: 'Shrink Selection', disabled: true }
      ]
    },
    {
      label: 'View',
      items: [
        {
          label: 'Command Palette...',
          shortcut: 'Ctrl+K',
          action: onCommandPalette
        },
        {
          label: 'Toggle Sidebar',
          shortcut: 'Ctrl+B',
          disabled: !hasOpenFolder || !activeProjectId,
          action: () => {
            if (activeProjectId) toggleSidebar(activeProjectId)
          }
        },
        { label: 'Toggle Terminal', disabled: true }
      ]
    },
    {
      label: 'Go',
      items: [
        { label: 'Go to File...', shortcut: 'Ctrl+P', disabled: true },
        { label: 'Go to Line...', shortcut: 'Ctrl+G', disabled: true }
      ]
    },
    {
      label: 'Run',
      items: [
        { label: 'Run Task...', disabled: true },
        { label: 'Run Build Task', disabled: true }
      ]
    },
    {
      label: 'Terminal',
      items: [
        {
          label: 'Terminal',
          shortcut: 'Ctrl+`',
          action: () => addPanel('terminal')
        },
        {
          label: 'Claude',
          action: () => addPanel('claude')
        },
        {
          label: 'Cursor',
          action: () => addPanel('cursor')
        },
        {
          label: 'Gemini',
          action: () => addPanel('gemini')
        },
        {
          label: 'Antigravity',
          action: () => addPanel('antigravity')
        },
        {
          label: 'Codex',
          action: () => addPanel('codex')
        },
        {
          label: 'ChatGPT',
          action: () => addPanel('chatgpt')
        },
        {
          label: 'Claude Chat',
          action: () => addPanel('claude-chat')
        }
      ]
    },
    {
      label: 'Help',
      items: [
        { label: 'Documentation', disabled: true },
        {
          label: 'About BIKORCH',
          action: () => {
            // Placeholder — can open about dialog later
          }
        }
      ]
    }
  ]

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {menus.map((menu) => (
        <MenuDropdown
          key={menu.label}
          menu={menu}
          open={openMenu === menu.label}
          onToggle={() => setOpenMenu((current) => (current === menu.label ? null : menu.label))}
          onClose={() => setOpenMenu(null)}
        />
      ))}
    </div>
  )
}
