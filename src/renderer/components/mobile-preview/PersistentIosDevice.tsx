import { lazy, Suspense, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { CanvasDeviceInteractionContext } from '@renderer/components/mobile-preview/canvas-device-context'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

const IosSimulatorScreen = lazy(() =>
  import('@renderer/components/mobile-preview/IosSimulatorScreen').then((m) => ({
    default: m.IosSimulatorScreen
  }))
)

// The iOS device follows you across project tabs. Each tab has its own panel,
// so rendering the screen inside the panel would tear the simulator session
// down and start it again on every tab switch. Instead the screen is rendered
// once, into a node that lives for the whole app, and that node is moved into
// whichever panel is showing. Moving a DOM node does not remount React.

type CanvasInteraction = React.ContextType<typeof CanvasDeviceInteractionContext>

let screenNode: HTMLDivElement | null = null
let parkingNode: HTMLDivElement | null = null
let interaction: CanvasInteraction = null
const listeners = new Set<() => void>()

function getScreenNode(): HTMLDivElement {
  if (!screenNode) {
    screenNode = document.createElement('div')
    screenNode.className = 'persistent-device-screen'
    screenNode.style.cssText = 'display:contents'
  }
  return screenNode
}

function park(node: HTMLDivElement): void {
  if (parkingNode) parkingNode.appendChild(node)
  else node.remove()
}

function setInteraction(next: CanvasInteraction): void {
  if (interaction === next) return
  interaction = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Where the device shows inside a panel. */
export function IosDeviceSlot(): React.JSX.Element {
  const slotRef = useRef<HTMLDivElement>(null)
  const canvas = useContext(CanvasDeviceInteractionContext)

  useLayoutEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    const node = getScreenNode()
    slot.appendChild(node)
    return () => {
      // The next tab's slot may already hold it; only park it if it is still here.
      if (node.parentElement === slot) park(node)
    }
  }, [])

  useLayoutEffect(() => {
    setInteraction(canvas)
    return () => setInteraction(null)
  }, [canvas])

  return <div ref={slotRef} className="persistent-device-slot" style={{ display: 'contents' }} />
}

/**
 * An agent installed an app on a simulator: open the iOS panel so it shows up
 * without asking. Someone on the Home tab stays there; the panel waits in the tab.
 */
function openPanelForInstall(): void {
  const store = useWorkspaceStore.getState()
  const workspace = store.getActiveWorkspace()
  if (!workspace || workspace.panels.some((panel) => panel.type === 'ios-preview')) return
  const onHome = store.homeVisible
  store.addPanel('ios-preview', 'right')
  if (onHome) store.showHome()
}

/** Keeps the one iOS device screen alive while any tab has the device open. */
export function PersistentIosDeviceHost(): React.JSX.Element | null {
  const open = useWorkspaceStore((state) =>
    Object.values(state.workspaces).some((workspace) =>
      workspace.panels.some((panel) => panel.type === 'ios-preview')
    )
  )
  const canvas = useSyncExternalStore(subscribe, () => interaction)
  const parkingRef = useRef<HTMLDivElement>(null)

  useEffect(() => window.api?.simulator?.onAppInstalled(openPanelForInstall), [])

  useLayoutEffect(() => {
    parkingNode = parkingRef.current
    return () => {
      parkingNode = null
    }
  }, [])

  return (
    <>
      <div ref={parkingRef} hidden aria-hidden />
      {open &&
        createPortal(
          <CanvasDeviceInteractionContext.Provider value={canvas}>
            <Suspense fallback={null}>
              <IosSimulatorScreen />
            </Suspense>
          </CanvasDeviceInteractionContext.Provider>,
          getScreenNode()
        )}
    </>
  )
}
