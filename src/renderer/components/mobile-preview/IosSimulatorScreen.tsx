import { useContext, useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { SimulatorStatus } from '@shared/contracts/simulator'
import { CanvasDeviceInteractionContext } from '@renderer/components/mobile-preview/canvas-device-context'
import { normalizeContainedPointer } from '@renderer/components/mobile-preview/simulator-geometry'
import { Button } from '@renderer/components/ui/Button'
import { onDocumentVisibility } from '@renderer/lib/visibility'
import { cn } from '@renderer/lib/utils'

const STARTING: SimulatorStatus = {
  phase: 'starting',
  message: 'Opening Xcode Simulator…'
}

export function IosSimulatorScreen(): React.JSX.Element {
  const canvas = useContext(CanvasDeviceInteractionContext)
  const screenRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const pressed = useRef(false)
  const [status, setStatus] = useState<SimulatorStatus>(STARTING)
  const [frame, setFrame] = useState<string | null>(null)
  const frameRef = useRef<string | null>(null)

  useEffect(() => {
    const api = window.api?.simulator
    if (!api) {
      setStatus({ phase: 'unavailable', message: 'The iOS Simulator bridge is not available in this window.' })
      return
    }
    let alive = true
    const unsubscribe = api.onEvent((event) => {
      if (!alive) return
      if (event.type === 'status') setStatus(event.status)
      if (event.type !== 'frame') return
      const bytes = new ArrayBuffer(event.jpeg.byteLength)
      new Uint8Array(bytes).set(event.jpeg)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
      const previous = frameRef.current
      frameRef.current = url
      setFrame(url)
      if (previous) URL.revokeObjectURL(previous)
    })
    void api.attach().then((next) => {
      if (alive) setStatus(next)
    }).catch(() => {
      if (alive) setStatus({ phase: 'unavailable', message: 'Could not open the iOS Simulator.' })
    })
    return () => {
      alive = false
      unsubscribe()
      void api.detach()
      if (frameRef.current) URL.revokeObjectURL(frameRef.current)
      frameRef.current = null
    }
  }, [])

  // A hidden window needs no frames: let the capture stop until it is visible again.
  useEffect(() => {
    const api = window.api?.simulator
    if (!api) return
    let paused = false
    const stop = onDocumentVisibility((hidden) => {
      if (hidden && !paused) {
        paused = true
        void api.detach()
      } else if (!hidden && paused) {
        paused = false
        void api.attach().then(setStatus).catch(() => undefined)
      }
    })
    // The mount effect's detach ends the session; refs never go below zero.
    return stop
  }, [])

  const retry = (): void => {
    const api = window.api?.simulator
    if (!api) return
    setStatus(STARTING)
    void api.detach().then(() => api.attach()).then((next) => setStatus(next))
  }

  const pointFrom = (event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const image = imageRef.current
    return normalizeContainedPointer(
      { width: bounds.width, height: bounds.height },
      { width: image?.naturalWidth ?? 0, height: image?.naturalHeight ?? 0 },
      event.clientX - bounds.left,
      event.clientY - bounds.top
    )
  }

  const sendPointer = (phase: 'down' | 'move' | 'up', event: React.PointerEvent<HTMLDivElement>): void => {
    const point = pointFrom(event)
    if (!point || !window.api?.simulator) return
    void window.api.simulator.pointer({ phase, ...point })
  }

  const showStatus = status.phase !== 'live' || !frame
  const lcd = status.mode !== 'window'

  return (
    <div className="mobile-preview-workbench mobile-canvas-device">
      <div className="mobile-preview-stage">
        <section className="mobile-device mobile-device-ios is-canvas-device" aria-label={status.deviceName ? `${status.deviceName} simulator` : 'iOS Simulator'}>
          <div className="mobile-device-content">
            <div className={cn('mobile-device-frame', status.mode === 'window' && 'is-window-feed')}>
              {lcd ? <span className="mobile-ios-island" aria-hidden /> : null}
              <div
                ref={screenRef}
                className="mobile-device-screen mobile-sim-screen"
                tabIndex={status.phase === 'live' ? 0 : -1}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  pressed.current = true
                  event.currentTarget.setPointerCapture(event.pointerId)
                  event.currentTarget.focus()
                  sendPointer('down', event)
                }}
                onPointerMove={(event) => {
                  if (!pressed.current) return
                  sendPointer('move', event)
                }}
                onPointerUp={(event) => {
                  if (!pressed.current) return
                  pressed.current = false
                  sendPointer('up', event)
                }}
                onPointerCancel={() => {
                  pressed.current = false
                }}
                onKeyDown={(event) => {
                  if (event.metaKey || event.ctrlKey || event.altKey) return
                  const key = event.key
                  if (key === 'Enter' || key === 'Backspace' || key === 'Escape' || key === 'Tab' || key === ' ' || key.startsWith('Arrow')) {
                    event.preventDefault()
                    event.stopPropagation()
                    const name = key === ' ' ? 'space' : key === 'Backspace' ? 'backspace' : key === 'Escape' ? 'escape' : key === 'Tab' ? 'tab' : key === 'Enter' ? 'enter' : key.toLowerCase()
                    void window.api?.simulator?.key({ key: name })
                    return
                  }
                  if (key.length !== 1) return
                  event.preventDefault()
                  event.stopPropagation()
                  void window.api?.simulator?.key({ text: key })
                }}
              >
                {frame ? <img ref={imageRef} className="mobile-sim-feed" src={frame} alt="" draggable={false} /> : null}
                {status.phase === 'live' && status.inputReady === false ? (
                  <div className="mobile-sim-hint">
                    <span>Allow Bikorch in Accessibility to tap and type.</span>
                    <span className="mobile-sim-hint-actions">
                      <button type="button" onClick={() => void window.api?.simulator?.openAccessibility()}>Open settings</button>
                      <button type="button" onClick={retry}>Check again</button>
                    </span>
                  </div>
                ) : null}
                {showStatus ? (
                  <div className="mobile-sim-status">
                    {status.phase === 'starting' ? <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden /> : null}
                    <strong>{status.phase === 'unavailable' ? 'iOS Simulator' : 'Xcode Simulator'}</strong>
                    <p>{status.message}</p>
                    {status.phase === 'unavailable' ? (
                      <Button variant="secondary" onClick={retry}>Try again</Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {lcd ? <span className="mobile-device-home" aria-hidden /> : null}
              {canvas?.onClose ? (
                <div className="mobile-device-actions is-overlay">
                  <button type="button" className="browser-icon-btn" onClick={canvas.onClose} aria-label="Close device" title="Close device">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
