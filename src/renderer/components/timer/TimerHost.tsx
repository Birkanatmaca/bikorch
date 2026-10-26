import { useEffect } from 'react'
import { useTimerStore } from '@renderer/stores/timer-store'
import { isDocumentHidden, onDocumentVisibility } from '@renderer/lib/visibility'

// The clock shows whole seconds, so half-second ticks keep it on time. An idle
// timer only needs the occasional tick for day rollover in the stats.
const RUNNING_TICK_MS = 500
const HIDDEN_RUNNING_TICK_MS = 1000
const IDLE_TICK_MS = 60_000

export function TimerHost(): null {
  const tick = useTimerStore((state) => state.tick)
  const running = useTimerStore((state) => state.session.status === 'running')

  useEffect(() => {
    useTimerStore.getState().hydrate()
    return () => useTimerStore.getState().persistNow()
  }, [])

  useEffect(() => {
    let id: number | null = null
    const arm = (hidden: boolean): void => {
      if (id !== null) window.clearInterval(id)
      const delay = !running ? IDLE_TICK_MS : hidden ? HIDDEN_RUNNING_TICK_MS : RUNNING_TICK_MS
      id = window.setInterval(() => tick(), delay)
    }
    tick()
    arm(isDocumentHidden())
    const stop = onDocumentVisibility((hidden) => {
      if (!hidden) tick()
      arm(hidden)
    })
    return () => {
      if (id !== null) window.clearInterval(id)
      stop()
    }
  }, [tick, running])

  return null
}
