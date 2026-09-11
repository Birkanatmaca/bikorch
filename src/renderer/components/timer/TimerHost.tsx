import { useEffect } from 'react'
import { useTimerStore } from '@renderer/stores/timer-store'

export function TimerHost(): null {
  const tick = useTimerStore((state) => state.tick)

  useEffect(() => {
    useTimerStore.getState().hydrate()
    const id = window.setInterval(() => tick(), 250)
    return () => {
      window.clearInterval(id)
      useTimerStore.getState().persistNow()
    }
  }, [tick])

  return null
}
