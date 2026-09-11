import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Menu, ChevronRight } from 'lucide-react'
import { Button } from '@renderer/components/ui/Button'
import { isMacOS } from '@renderer/lib/electron-api'
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

function shortcutLabel(shortcut: string): string {
  return isMacOS() ? shortcut.replaceAll('Ctrl+', '⌘ ') : shortcut
}

function MenuItems({
  items,
  onPicked
}: {
  items: MenuItem[]
  onPicked?: () => void
}): React.JSX.Element {
  return (
    <>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          disabled={item.disabled}
          className="desktop-menu-item"
          onClick={() => {
            if (item.disabled || !item.action) return
            item.action()
            onPicked?.()
          }}
        >
          <span>{item.label}</span>
          {item.shortcut && <kbd>{shortcutLabel(item.shortcut)}</kbd>}
        </button>
      ))}
    </>
  )
}

function CompactMenu({ menus }: { menus: MenuDefinition[] }): React.JSX.Element {
  return (
    <div className="menubar-compact">
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" aria-label="Application menu">
            <Menu className="h-3.5 w-3.5" />
            Menu
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="desktop-menu" align="start" sideOffset={6} collisionPadding={8}>
            {menus.map((menu) => (
              <DropdownMenu.Sub key={menu.label}>
                <DropdownMenu.SubTrigger className="desktop-menu-item">
                  {menu.label}
                  <ChevronRight className="h-3 w-3" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent className="desktop-menu" sideOffset={6} collisionPadding={8}>
                    {menu.items.map((item) => (
                      <DropdownMenu.Item
                        key={item.label}
                        disabled={item.disabled}
                        onSelect={item.action}
                        className="desktop-menu-item"
                      >
                        <span>{item.label}</span>
                        {item.shortcut && <kbd>{shortcutLabel(item.shortcut)}</kbd>}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

export function MenuBar({ onCommandPalette, className }: MenuBarProps): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 })
  const { openFolderPicker } = useOpenProject()
  const addPanel = useWorkspaceStore((s) => s.addPanel)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar)
  const setCanvasMode = useWorkspaceStore((s) => s.setCanvasMode)
  const hasOpenFolder = useHasOpenFolder()

  const menus = useMemo<MenuDefinition[]>(
    () => [
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
          { label: 'Toggle Terminal', disabled: true },
          {
            label: 'Layout: Free',
            disabled: !activeProjectId,
            action: () => setCanvasMode('free')
          },
          {
            label: 'Layout: Tiled',
            disabled: !activeProjectId,
            action: () => setCanvasMode('tiled')
          },
          {
            label: 'Layout: 2×2',
            disabled: !activeProjectId,
            action: () => setCanvasMode('grid-2x2')
          },
          {
            label: 'Layout: 4 Columns',
            disabled: !activeProjectId,
            action: () => setCanvasMode('cols-4')
          },
          {
            label: 'Layout: 4 Rows',
            disabled: !activeProjectId,
            action: () => setCanvasMode('rows-4')
          }
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
          { label: 'Terminal', shortcut: 'Ctrl+`', action: () => addPanel('terminal') },
          { label: 'Claude', action: () => addPanel('claude') },
          { label: 'Cursor', action: () => addPanel('cursor') },
          { label: 'Gemini', action: () => addPanel('gemini') },
          { label: 'Antigravity', action: () => addPanel('antigravity') },
          { label: 'Codex', action: () => addPanel('codex') },
          { label: 'ChatGPT', action: () => addPanel('chatgpt') },
          { label: 'Claude Chat', action: () => addPanel('claude-chat') },
          { label: 'Player', action: () => addPanel('player') },
          { label: 'Timer', action: () => addPanel('timer') },
          { label: 'Browser', action: () => addPanel('browser') }
        ]
      },
      {
        label: 'Help',
        items: [
          { label: 'Documentation', disabled: true },
          { label: 'About BIKORCH', action: () => undefined }
        ]
      }
    ],
    [activeProjectId, addPanel, hasOpenFolder, onCommandPalette, openFolderPicker, setCanvasMode, toggleSidebar]
  )

  const current = menus.find((menu) => menu.label === openMenu) ?? null

  useLayoutEffect(() => {
    if (!openMenu) return
    const trigger = triggerRefs.current[openMenu]
    if (!trigger) return
    const box = trigger.getBoundingClientRect()
    const width = 220
    const maxLeft = Math.max(8, window.innerWidth - width - 8)
    setPanelPos({
      top: Math.round(box.bottom + 4),
      left: Math.round(Math.min(maxLeft, Math.max(8, box.left)))
    })
  }, [openMenu])

  useEffect(() => {
    if (!openMenu) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (barRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpenMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenMenu(null)
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const index = menus.findIndex((menu) => menu.label === openMenu)
      if (index < 0) return
      const next = event.key === 'ArrowRight' ? (index + 1) % menus.length : (index - 1 + menus.length) % menus.length
      setOpenMenu(menus[next].label)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menus, openMenu])

  return (
    <div ref={barRef} className={cn('menubar flex items-center gap-0.5', className)}>
      <CompactMenu menus={menus} />
      <div className="menubar-full flex items-center" role="menubar" aria-label="Application">
        {menus.map((menu) => {
          const open = openMenu === menu.label
          return (
            <button
              key={menu.label}
              ref={(node) => {
                triggerRefs.current[menu.label] = node
              }}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open}
              className={cn('menubar-trigger app-no-drag', open && 'is-open')}
              onClick={() => {
                setOpenMenu((currentLabel) => (currentLabel === menu.label ? null : menu.label))
              }}
              onPointerEnter={() => {
                setOpenMenu((currentLabel) => (currentLabel === null ? currentLabel : menu.label))
              }}
            >
              {menu.label}
            </button>
          )
        })}
      </div>
      {current &&
        createPortal(
          <div
            ref={panelRef}
            className="desktop-menu desktop-menu-flyout app-no-drag"
            role="menu"
            aria-label={current.label}
            style={{ top: panelPos.top, left: panelPos.left }}
          >
            <MenuItems items={current.items} onPicked={() => setOpenMenu(null)} />
          </div>,
          document.body
        )}
    </div>
  )
}
