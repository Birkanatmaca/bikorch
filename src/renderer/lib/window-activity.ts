import { isDocumentHidden, onDocumentVisibility } from './visibility'

const ATTRIBUTE = 'data-window-inactive'

let focused = true
const listeners = new Set<(inactive: boolean) => void>()

/** True while the window is blurred, minimized or hidden. */
export function isWindowInactive(): boolean {
  return !focused || isDocumentHidden()
}

export function onWindowActivity(callback: (inactive: boolean) => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/**
 * Marks the root element while the window is inactive so CSS can pause decorative
 * animations, and notifies pollers so they can slow down. Focus comes from the
 * main process because the DOM `blur` event also fires when focus moves into a
 * webview inside the window.
 */
export function trackWindowActivity(root: HTMLElement = document.documentElement): () => void {
  let last: boolean | null = null
  const apply = (): void => {
    const inactive = isWindowInactive()
    if (inactive) root.setAttribute(ATTRIBUTE, '')
    else root.removeAttribute(ATTRIBUTE)
    if (inactive === last) return
    last = inactive
    for (const listener of listeners) listener(inactive)
  }

  const api = window.api?.window
  void api?.getState?.().then((state) => {
    focused = state.focused
    apply()
  })
  const stopState = api?.onStateChange?.((state) => {
    focused = state.focused
    apply()
  })
  const stopVisibility = onDocumentVisibility(apply)
  apply()

  return () => {
    stopState?.()
    stopVisibility()
    root.removeAttribute(ATTRIBUTE)
  }
}
