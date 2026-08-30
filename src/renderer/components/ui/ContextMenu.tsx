import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/utils'

export interface ContextMenuItem {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  icon?: React.ComponentType<{ className?: string }>
  action: () => void
}

export interface ContextMenuGroup {
  id: string
  items: ContextMenuItem[]
}

interface ContextMenuProps {
  open: boolean
  x: number
  y: number
  groups: ContextMenuGroup[]
  onClose: () => void
}

export function ContextMenu({
  open,
  x,
  y,
  groups,
  onClose
}: ContextMenuProps): React.JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return
    const menu = menuRef.current
    const { innerWidth, innerHeight } = window
    const rect = menu.getBoundingClientRect()
    let left = x
    let top = y
    if (left + rect.width > innerWidth - 8) left = innerWidth - rect.width - 8
    if (top + rect.height > innerHeight - 8) top = innerHeight - rect.height - 8
    menu.style.left = `${Math.max(8, left)}px`
    menu.style.top = `${Math.max(8, top)}px`
  }, [open, x, y])

  useEffect(() => {
    if (!open) return

    const handlePointer = (e: MouseEvent): void => {
      if (menuRef.current?.contains(e.target as Node)) return
      onClose()
    }

    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[9999] min-w-[220px] overflow-hidden rounded-lg border border-border bg-elevated py-1 shadow-xl animate-slide-up"
      style={{ left: x, top: y }}
    >
      {groups.map((group, groupIndex) => (
        <div key={group.id}>
          {groupIndex > 0 && <div className="my-1 border-t border-border" />}
          {group.items.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return
                  item.action()
                  onClose()
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                  item.disabled
                    ? 'cursor-not-allowed text-text-muted/50'
                    : item.danger
                      ? 'text-error hover:bg-error/10'
                      : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                <span className="flex-1">{item.label}</span>
                {item.shortcut && (
                  <span className="font-mono text-[10px] text-text-muted">{item.shortcut}</span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </div>,
    document.body
  )
}

export function rectFromCanvasClick(
  canvas: DOMRect,
  clientX: number,
  clientY: number,
  size: { w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  if (canvas.width <= 0 || canvas.height <= 0) {
    return { x: 8.333, y: 10, w: size.w, h: size.h }
  }
  return {
    x: ((clientX - canvas.left) / canvas.width) * 100,
    y: ((clientY - canvas.top) / canvas.height) * 100,
    w: size.w,
    h: size.h
  }
}
