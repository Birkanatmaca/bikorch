import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, MessageCircle } from 'lucide-react'
import { CLI_LOGO_CLASS, getCliLogo } from '@renderer/lib/cli-logos'
import { cn } from '@renderer/lib/utils'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

const MENU_WIDTH = 176

export function ChatMenu(): React.JSX.Element {
  const addPanel = useWorkspaceStore((s) => s.addPanel)
  const chatgptLogo = getCliLogo('chatgpt')
  const claudeChatLogo = getCliLogo('claude-chat')
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const ignoreNextOutsideRef = useRef(false)

  const updateMenuPosition = (): void => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    setMenuStyle({
      top: rect.bottom + 6,
      left: Math.max(8, rect.right - MENU_WIDTH)
    })
  }

  const openMenu = (): void => {
    updateMenuPosition()
    ignoreNextOutsideRef.current = true
    setOpen(true)
    window.requestAnimationFrame(() => {
      ignoreNextOutsideRef.current = false
    })
  }

  const closeMenu = (): void => {
    setOpen(false)
  }

  useLayoutEffect(() => {
    if (!open) return
    updateMenuPosition()
  }, [open])

  useEffect(() => {
    if (!open) return

    const handlePointerDownOutside = (event: PointerEvent): void => {
      if (ignoreNextOutsideRef.current) return
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu()
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }

    const handleReposition = (): void => {
      updateMenuPosition()
    }

    document.addEventListener('pointerdown', handlePointerDownOutside)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [open])

  const openChatPanel = (type: 'chatgpt' | 'claude-chat'): void => {
    addPanel(type, 'right')
    closeMenu()
  }

  const menu =
    open && menuStyle ? (
      <div
        ref={menuRef}
        role="menu"
        className="header-dropdown-menu app-no-drag fixed z-[10001] w-44 overflow-hidden rounded-xl border border-border bg-elevated py-1 shadow-2xl animate-scale-in"
        style={{ top: menuStyle.top, left: menuStyle.left }}
      >
        <p className="px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
          Open chat
        </p>
        <button
          type="button"
          role="menuitem"
          onClick={() => openChatPanel('chatgpt')}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
        >
          <img src={chatgptLogo ?? undefined} alt="" className={CLI_LOGO_CLASS} />
          ChatGPT
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => openChatPanel('claude-chat')}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
        >
          <img src={claudeChatLogo ?? undefined} alt="" className={CLI_LOGO_CLASS} />
          Claude
        </button>
      </div>
    ) : null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? closeMenu() : openMenu())}
        className={cn(
          'glass-button app-no-drag h-7 px-1.5',
          open && 'glass-button-primary'
        )}
        title="Open chat assistant"
        aria-label="Open chat assistant"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MessageCircle className="h-3.5 w-3.5 text-primary" />
        <ChevronDown className="h-3 w-3 text-text-muted" />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}
