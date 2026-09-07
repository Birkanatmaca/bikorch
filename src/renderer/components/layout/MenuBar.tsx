import { useState } from 'react'
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

function MenuItems({ items }: { items: MenuItem[] }): React.JSX.Element {
  return (
    <>
      {items.map((item) => (
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
    </>
  )
}

function MenuDropdown({ menu, open, onToggle, onClose }: {
  menu: MenuDefinition
  open: boolean
  onToggle: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <DropdownMenu.Root open={open} onOpenChange={(next) => next ? onToggle() : onClose()} modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" className="menubar-trigger">{menu.label}</Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="desktop-menu" align="start" sideOffset={6} collisionPadding={8}>
          <MenuItems items={menu.items} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function CompactMenu({ menus }: { menus: MenuDefinition[] }): React.JSX.Element {
  return (
    <div className="menubar-compact">
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" aria-label="Application menu"><Menu className="h-3.5 w-3.5" />Menu</Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="desktop-menu" align="start" sideOffset={6} collisionPadding={8}>
            {menus.map((menu) => (
              <DropdownMenu.Sub key={menu.label}>
                <DropdownMenu.SubTrigger className="desktop-menu-item">
                  {menu.label}<ChevronRight className="h-3 w-3" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent className="desktop-menu" sideOffset={6} collisionPadding={8}>
                    <MenuItems items={menu.items} />
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
    <div className={cn('menubar flex items-center gap-0.5', className)}>
      <CompactMenu menus={menus} />
      <div className="menubar-full flex items-center gap-0.5">
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
    </div>
  )
}
