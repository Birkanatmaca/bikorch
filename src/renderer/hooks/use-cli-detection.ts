import { useEffect } from 'react'
import { useCliStore } from '@renderer/stores/cli-store'

let subscribers = 0
let statusTimer: ReturnType<typeof setInterval> | null = null
const onFocus = (): void => { void useCliStore.getState().refresh() }

export function useCliDetection(): void {
  useEffect(() => {
    if (subscribers++ === 0) {
      void useCliStore.getState().refresh()
      window.addEventListener('focus', onFocus)
      statusTimer = setInterval(() => {
        if (useCliStore.getState().installingKind) void useCliStore.getState().syncStatus()
      }, 1_500)
    }
    return () => {
      if (--subscribers === 0) {
        window.removeEventListener('focus', onFocus)
        if (statusTimer !== null) clearInterval(statusTimer)
        statusTimer = null
      }
    }
  }, [])
}
