import { useCallback, useRef } from 'react'

const DRAG_THRESHOLD_SQ = 16
const IGNORE_SELECTOR =
  'button, a, input, textarea, select, [role="tab"], [role="menuitem"], [role="menu"], .app-no-drag'

function canDragWindow(): boolean {
  return typeof window.api?.window?.dragStart === 'function'
}

export function useWindowDrag(): {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void
  onLostPointerCapture: (event: React.PointerEvent<HTMLElement>) => void
} {
  const pointerIdRef = useRef<number | null>(null)
  const startedRef = useRef(false)
  const originRef = useRef({ x: 0, y: 0 })

  const finish = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (pointerIdRef.current !== event.pointerId) return
    if (startedRef.current) window.api.window.dragEnd()
    startedRef.current = false
    pointerIdRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!canDragWindow() || event.button !== 0 || event.detail > 1) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest(IGNORE_SELECTOR)) return

    pointerIdRef.current = event.pointerId
    startedRef.current = false
    originRef.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (pointerIdRef.current !== event.pointerId) return
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      finish(event)
      return
    }
    if (!startedRef.current) {
      const dx = event.clientX - originRef.current.x
      const dy = event.clientY - originRef.current.y
      if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return
      startedRef.current = true
      window.api.window.dragStart()
    }
    window.api.window.dragMove()
  }, [finish])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish
  }
}
