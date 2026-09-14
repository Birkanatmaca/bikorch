import { useEffect } from 'react'
import { useTimerStore } from '@renderer/stores/timer-store'
import { isDocumentHidden, onDocumentVisibility } from '@renderer/lib/visibility'

export function TimerHost(): null {
  const tick = useTimerStore((state) => state.tick)

  useEffect(() => {
    useTimerStore.getState().hydrate()
    let id: number | null = null
    const arm = (hidden: boolean): void => {
      if (id !== null) window.clearInterval(id)
      id = window.setInterval(() => tick(), hidden ? 1000 : 250)
    }
    arm(isDocumentHidden())
    const stop = onDocumentVisibility((hidden) => {
      if (!hidden) tick()
      arm(hidden)
    })
    return () => {
      if (id !== null) window.clearInterval(id)
      stop()
      useTimerStore.getState().persistNow()
    }
  }, [tick])

  return null
}
