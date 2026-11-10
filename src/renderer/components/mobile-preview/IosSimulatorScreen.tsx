import { useContext, useEffect, useRef, useState } from 'react'
import { Circle, Loader2, RotateCcw, RotateCw, X } from 'lucide-react'
import { turnDevice, type SimulatorStatus } from '@shared/contracts/simulator'
import { CanvasDeviceInteractionContext } from '@renderer/components/mobile-preview/canvas-device-context'
import { normalizeContainedPointer, unrotatePoint } from '@renderer/components/mobile-preview/simulator-geometry'
import { Button } from '@renderer/components/ui/Button'
import { isDocumentHidden, onDocumentVisibility } from '@renderer/lib/visibility'
import { cn } from '@renderer/lib/utils'

const STARTING: SimulatorStatus = {
  phase: 'starting',
  message: 'Starting the iOS Simulator…'
}

export function IosSimulatorScreen(): React.JSX.Element {
  const canvas = useContext(CanvasDeviceInteractionContext)
  const screenRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const pressed = useRef(false)
  const [status, setStatus] = useState<SimulatorStatus>(STARTING)
  // Frames go straight into the <img>; React only hears about the first one.
  const [hasFrame, setHasFrame] = useState(false)
  const [aspect, setAspect] = useState<number | null>(null)

  useEffect(() => {
    const api = window.api?.simulator
    if (!api) {
      setStatus({ phase: 'unavailable', message: 'The iOS Simulator bridge is not available in this window.' })
      return
    }
    let alive = true
    let shown: string | null = null
    let decoding = false
    let waiting: Uint8Array | null = null
    // Decodes off the main thread and keeps only the newest frame while one is
    // decoding, so a busy renderer drops frames instead of falling behind.
    const show = (jpeg: Uint8Array): void => {
      const image = imageRef.current
      if (!alive || !image) return
      if (decoding) {
        waiting = jpeg
        return
      }
      decoding = true
      const url = URL.createObjectURL(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }))
      image.src = url
      void image.decode().catch(() => undefined).then(() => {
        if (shown) URL.revokeObjectURL(shown)
        shown = url
        decoding = false
        if (!alive) return
        const { naturalWidth, naturalHeight } = image
        if (naturalWidth && naturalHeight) {
          const next = Math.round((naturalWidth / naturalHeight) * 1000) / 1000
          setAspect((current) => (current === next ? current : next))
        }
        setHasFrame(true)
        const next = waiting
        waiting = null
        if (next) show(next)
      })
    }
    const unsubscribe = api.onEvent((event) => {
      if (!alive) return
      if (event.type === 'status') setStatus(event.status)
      else if (event.type === 'frame') show(event.jpeg)
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
      if (shown) URL.revokeObjectURL(shown)
    }
  }, [])

  // Frames are encoded at the size the panel shows them, and not at all while
  // it is out of sight (another app in front, the Home tab, a collapsed panel).
  // The device keeps running meanwhile: an agent may be installing onto it.
  const sidewaysView = (status.rotation ?? 0) !== 0
  useEffect(() => {
    const api = window.api?.simulator
    const screen = screenRef.current
    if (!api || !screen) return
    let sent = ''
    const report = (): void => {
      const { width, height } = screen.getBoundingClientRect()
      const visible = width > 0 && height > 0 && !isDocumentHidden()
      // The portrait framebuffer's height runs across a turned screen.
      const long = sidewaysView ? width : height
      // Steps of 80px so a resize drag does not re-tune the encoder every frame.
      const pixels = Math.ceil((long * window.devicePixelRatio) / 80) * 80
      const key = `${visible}:${pixels}`
      if (key === sent) return
      sent = key
      void api.view({ visible, height: Math.max(320, pixels) })
    }
    const observer = new ResizeObserver(report)
    observer.observe(screen)
    const stop = onDocumentVisibility(report)
    report()
    return () => {
      observer.disconnect()
      stop()
    }
  }, [sidewaysView])

  const retry = (): void => {
    const api = window.api?.simulator
    if (!api) return
    setStatus(STARTING)
    void api.detach().then(() => api.attach()).then((next) => setStatus(next))
  }

  const pointFrom = (event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const image = imageRef.current
    const width = image?.naturalWidth ?? 0
    const height = image?.naturalHeight ?? 0
    // A turned device shows its portrait frame on its side.
    const point = normalizeContainedPointer(
      { width: bounds.width, height: bounds.height },
      sideways ? { width: height, height: width } : { width, height },
      event.clientX - bounds.left,
      event.clientY - bounds.top
    )
    return point ? unrotatePoint(point, rotation) : null
  }

  const sendPointer = (phase: 'down' | 'move' | 'up', event: React.PointerEvent<HTMLDivElement>): void => {
    const point = pointFrom(event)
    if (!point || !window.api?.simulator) return
    void window.api.simulator.pointer({ phase, ...point })
  }

  const rotation = status.rotation ?? 0
  const sideways = rotation !== 0
  const shownAspect = aspect && sideways ? Math.round((1 / aspect) * 1000) / 1000 : aspect
  const showStatus = status.phase !== 'live' || !hasFrame
  // The headless feed already carries the real island and home indicator.
  const lcd = status.mode === 'screen'
  const canPressHome = status.phase === 'live' && status.mode === 'device'
  const pressHome = (): void => {
    void window.api?.simulator?.button('home')
  }
  // Only the headless feed can turn the device; Simulator.app turns its own window.
  const turn = (direction: 'left' | 'right'): void => {
    void window.api?.simulator?.rotate(turnDevice(rotation, direction))
  }

  return (
    <div className="mobile-preview-workbench mobile-canvas-device">
      <div className="mobile-preview-stage">
        <section className="mobile-device mobile-device-ios is-canvas-device" aria-label={status.deviceName ? `${status.deviceName} simulator` : 'iOS Simulator'}>
          <div className="mobile-device-content">
            <div
              className={cn(
                'mobile-device-frame',
                status.mode === 'window' && 'is-window-feed',
                status.mode === 'device' && aspect && 'is-device-feed'
              )}
              style={shownAspect ? ({ '--sim-aspect': String(shownAspect) } as React.CSSProperties) : undefined}
            >
              {lcd ? <span className="mobile-ios-island" aria-hidden /> : null}
              <div
                ref={screenRef}
                className={cn('mobile-device-screen mobile-sim-screen', sideways && 'is-sideways')}
                style={sideways ? ({ '--sim-rotate': `${rotation === 270 ? -90 : 90}deg` } as React.CSSProperties) : undefined}
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
                  // ⌘⇧H goes home, as in Simulator.app.
                  if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'h') {
                    event.preventDefault()
                    event.stopPropagation()
                    pressHome()
                    return
                  }
                  // ⌘← and ⌘→ turn the device, as in Simulator.app.
                  if (event.metaKey && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && canPressHome) {
                    event.preventDefault()
                    event.stopPropagation()
                    turn(event.key === 'ArrowLeft' ? 'left' : 'right')
                    return
                  }
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
                <img
                  ref={imageRef}
                  className="mobile-sim-feed"
                  alt=""
                  draggable={false}
                  hidden={!hasFrame}
                />
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
              {canvas?.onClose || canPressHome ? (
                <div className="mobile-device-actions is-overlay">
                  {canPressHome ? (
                    <>
                      <button type="button" className="browser-icon-btn" onClick={pressHome} aria-label="Home" title="Home (⌘⇧H)">
                        <Circle className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="browser-icon-btn"
                        onClick={() => turn('left')}
                        disabled={rotation === 270}
                        aria-label="Rotate left"
                        title="Rotate left (⌘←)"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="browser-icon-btn"
                        onClick={() => turn('right')}
                        disabled={rotation === 90}
                        aria-label="Rotate right"
                        title="Rotate right (⌘→)"
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : null}
                  {canvas?.onClose ? (
                    <button type="button" className="browser-icon-btn" onClick={canvas.onClose} aria-label="Close device" title="Close device">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
