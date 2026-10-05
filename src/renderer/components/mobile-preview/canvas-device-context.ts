import { createContext, type PointerEvent } from 'react'

export const CanvasDeviceInteractionContext = createContext<{
  onMoveStart: (event: PointerEvent) => void
  onClose: () => void
  /** Refits the canvas window to a device's width / height ratio, keeping its height. */
  onAspectChange: (aspect: number) => void
} | null>(null)
