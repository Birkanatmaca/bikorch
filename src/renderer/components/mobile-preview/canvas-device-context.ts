import { createContext, type PointerEvent } from 'react'

export const CanvasDeviceInteractionContext = createContext<{
  onMoveStart: (event: PointerEvent) => void
  onClose: () => void
} | null>(null)
