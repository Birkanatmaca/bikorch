import { useEffect, useState } from 'react'
import { isTypingInTerminal } from '@renderer/lib/app-events'

export function useCommandPalette(): {
  open: boolean
  openPalette: () => void
  closePalette: () => void
  togglePalette: () => void
} {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (isTypingInTerminal(e.target)) return

      const isMod = e.ctrlKey || e.metaKey

      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return {
    open,
    openPalette: () => setOpen(true),
    closePalette: () => setOpen(false),
    togglePalette: () => setOpen((v) => !v)
  }
}
