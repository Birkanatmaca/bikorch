import { useEffect, useState } from 'react'
import type { WindowChromeState } from '@shared/contracts/window'

const IDLE: WindowChromeState = { maximized: false, fullScreen: false }

export function useWindowChrome(): WindowChromeState {
  const [state, setState] = useState<WindowChromeState>(IDLE)

  useEffect(() => {
    const api = window.api?.window
    if (!api?.getState || !api.onStateChange) return
    void api.getState().then(setState)
    return api.onStateChange(setState)
  }, [])

  return state
}
