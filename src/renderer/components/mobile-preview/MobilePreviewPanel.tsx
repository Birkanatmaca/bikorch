import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, RefreshCw, Search, Smartphone, Square, Video } from 'lucide-react'
import {
  LOCAL_BROWSER_PRESETS,
  resolveBrowserNavigation
} from '@shared/contracts/browser'
import { useBrowserStore } from '@renderer/stores/browser-store'
import { Button } from '@renderer/components/ui/Button'
import { cn } from '@renderer/lib/utils'

type GuestWebview = HTMLElement & {
  src: string
  reload?: () => void
  setZoomFactor?: (factor: number) => void
  capturePage?: () => Promise<{ toDataURL: () => string }>
}

interface DeviceSpec {
  id: 'ios' | 'android'
  name: string
  subtitle: string
  viewport: string
  zoom: number
}

type DeviceCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const DEVICES: readonly DeviceSpec[] = [
  {
    id: 'ios',
    name: 'iPhone 15 Pro',
    subtitle: 'iOS · 393 × 852',
    viewport: '393 × 852',
    zoom: 0.6
  },
  {
    id: 'android',
    name: 'Pixel 8',
    subtitle: 'Android · 412 × 915',
    viewport: '412 × 915',
    zoom: 0.568
  }
]

const CAPTURE_SCALE = 2

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}

function imageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not prepare device screenshot'))
    image.src = dataUrl
  })
}

async function renderFramedDevice(guest: GuestWebview, device: DeviceSpec): Promise<HTMLCanvasElement> {
  if (!guest.capturePage) throw new Error('Screen capture is not available yet')
  const nativeImage = await guest.capturePage()
  const screen = await imageFromDataUrl(nativeImage.toDataURL())
  const android = device.id === 'android'
  const width = android ? 258 : 262
  const height = android ? 544 : 537
  const canvas = document.createElement('canvas')
  canvas.width = width * CAPTURE_SCALE
  canvas.height = height * CAPTURE_SCALE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create recording canvas')
  context.scale(CAPTURE_SCALE, CAPTURE_SCALE)

  const inset = android ? 12 : 13
  const screenRadius = android ? 22 : 29
  const frameRadius = android ? 31 : 39
  roundedRect(context, 1, 1, width - 2, height - 2, frameRadius)
  const shell = context.createLinearGradient(0, 0, width, height)
  shell.addColorStop(0, android ? '#333841' : '#30343d')
  shell.addColorStop(0.52, '#090b0f')
  shell.addColorStop(1, android ? '#292e36' : '#393e48')
  context.fillStyle = shell
  context.fill()
  context.strokeStyle = 'rgba(255,255,255,0.22)'
  context.lineWidth = 2
  context.stroke()

  const screenX = inset
  const screenY = inset
  const screenWidth = width - inset * 2
  const screenHeight = height - inset * 2
  context.save()
  roundedRect(context, screenX, screenY, screenWidth, screenHeight, screenRadius)
  context.clip()
  context.drawImage(screen, screenX, screenY, screenWidth, screenHeight)
  context.restore()

  context.fillStyle = '#050608'
  if (android) {
    context.beginPath()
    context.arc(width / 2, 22, 5, 0, Math.PI * 2)
    context.fill()
  } else {
    roundedRect(context, width / 2 - 37, 17, 74, 20, 10)
    context.fill()
  }
  context.fillStyle = 'rgba(255,255,255,0.9)'
  roundedRect(context, width / 2 - (android ? 21 : 41), height - 19, android ? 42 : 82, 4, 2)
  context.fill()
  return canvas
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function captureFileName(device: DeviceSpec, extension: 'png' | 'webm'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  return `bikorch-${device.id}-preview-${stamp}.${extension}`
}

function MobileDevice({ device, url, reloadVersion }: { device: DeviceSpec; url: string; reloadVersion: number }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const guestRef = useRef<GuestWebview | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [scale, setScale] = useState(1)
  const recordingRef = useRef<{
    recorder: MediaRecorder
    interval: number
  } | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  const beginResize = (event: React.PointerEvent<HTMLButtonElement>, corner: DeviceCorner): void => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const startScale = scale
    const xDirection = corner.endsWith('right') ? 1 : -1
    const yDirection = corner.startsWith('bottom') ? 1 : -1
    const onMove = (moveEvent: PointerEvent): void => {
      const horizontal = (moveEvent.clientX - startX) * xDirection
      const vertical = (moveEvent.clientY - startY) * yDirection
      const delta = (horizontal + vertical) / 2
      setScale(Math.min(1.65, Math.max(0.55, startScale + delta / 274)))
    }
    const onEnd = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      resizeCleanupRef.current = null
    }
    resizeCleanupRef.current?.()
    resizeCleanupRef.current = onEnd
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host || !url) return

    const guest = document.createElement('webview') as GuestWebview
    guest.setAttribute('partition', 'persist:workspace-browser')
    guest.setAttribute('allowpopups', '')
    guest.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no, sandbox=yes')
    guest.className = 'mobile-preview-guest'
    guest.setAttribute('src', url)
    guestRef.current = guest

    const onStart = (): void => {
      setLoading(true)
      setFailed(false)
    }
    const onStop = (): void => setLoading(false)
    const onReady = (): void => {
      try {
        guest.setZoomFactor?.(device.zoom)
      } catch {
        // The page can still render at its visible device size if zoom is unavailable.
      }
    }
    const onFail = (): void => {
      setLoading(false)
      setFailed(true)
    }

    guest.addEventListener('did-start-loading', onStart)
    guest.addEventListener('did-stop-loading', onStop)
    guest.addEventListener('dom-ready', onReady)
    guest.addEventListener('did-fail-load', onFail)
    host.appendChild(guest)

    return () => {
      guest.removeEventListener('did-start-loading', onStart)
      guest.removeEventListener('did-stop-loading', onStop)
      guest.removeEventListener('dom-ready', onReady)
      guest.removeEventListener('did-fail-load', onFail)
      try {
        guest.setAttribute('src', 'about:blank')
      } catch {
        // already detached
      }
      guest.remove()
      if (guestRef.current === guest) guestRef.current = null
    }
  }, [device.zoom, url])

  useEffect(() => {
    if (reloadVersion > 0) guestRef.current?.reload?.()
  }, [reloadVersion])

  useEffect(() => () => {
    const active = recordingRef.current
    if (!active) return
    window.clearInterval(active.interval)
    active.recorder.stop()
  }, [])

  useEffect(() => () => resizeCleanupRef.current?.(), [])

  const takeScreenshot = async (): Promise<void> => {
    const guest = guestRef.current
    if (!guest || capturing) return
    setCapturing(true)
    try {
      const canvas = await renderFramedDevice(guest, device)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not encode screenshot')
      downloadBlob(blob, captureFileName(device, 'png'))
    } catch {
      setFailed(true)
    } finally {
      setCapturing(false)
    }
  }

  const stopRecording = (): void => {
    const active = recordingRef.current
    if (!active) return
    window.clearInterval(active.interval)
    recordingRef.current = null
    active.recorder.stop()
    setRecording(false)
  }

  const startRecording = async (): Promise<void> => {
    const guest = guestRef.current
    if (!guest || recording) return
    try {
      const canvas = await renderFramedDevice(guest, device)
      const stream = canvas.captureStream(8)
      const chunks: BlobPart[] = []
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? { mimeType: 'video/webm;codecs=vp9' }
        : { mimeType: 'video/webm' })
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        if (chunks.length > 0) downloadBlob(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }), captureFileName(device, 'webm'))
      }
      const paint = async (): Promise<void> => {
        if (!recordingRef.current) return
        try {
          const next = await renderFramedDevice(guest, device)
          const context = canvas.getContext('2d')
          context?.clearRect(0, 0, canvas.width, canvas.height)
          context?.drawImage(next, 0, 0)
        } catch {
          stopRecording()
        }
      }
      recorder.start(250)
      recordingRef.current = { recorder, interval: window.setInterval(() => void paint(), 125) }
      setRecording(true)
    } catch {
      setFailed(true)
    }
  }

  return (
    <section
      className={cn('mobile-device', `mobile-device-${device.id}`)}
      style={{ '--mobile-device-scale': scale } as React.CSSProperties}
      aria-label={`${device.name} preview`}
    >
      <div className="mobile-device-content">
        <div className="mobile-device-meta">
        <div>
          <strong>{device.name}</strong>
          <span>{device.subtitle}</span>
        </div>
        <div className="mobile-device-actions">
          {loading || capturing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-label="Loading" /> : null}
          <button type="button" onClick={() => void takeScreenshot()} disabled={capturing || recording} title="Save framed screenshot" aria-label={`Save ${device.name} screenshot`}>
            <Camera className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => (recording ? stopRecording() : void startRecording())} disabled={capturing} title={recording ? 'Stop recording' : 'Record framed video'} aria-label={recording ? `Stop ${device.name} recording` : `Record ${device.name} video`} className={cn(recording && 'is-recording')}>
            {recording ? <Square className="h-3 w-3" /> : <Video className="h-3.5 w-3.5" />}
          </button>
        </div>
        </div>
        <div className="mobile-device-frame">
          {device.id === 'ios' ? <span className="mobile-ios-island" aria-hidden /> : <span className="mobile-android-camera" aria-hidden />}
          <div ref={hostRef} className="mobile-device-screen" />
          <span className="mobile-device-home" aria-hidden />
          {failed ? <span className="mobile-device-failed">Could not load</span> : null}
        </div>
        <span className="mobile-device-viewport">CSS viewport {device.viewport}</span>
      </div>
      {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => (
        <button
          key={corner}
          type="button"
          className={cn('mobile-device-resize-handle', `is-${corner}`)}
          onPointerDown={(event) => beginResize(event, corner)}
          aria-label={`Resize ${device.name} from ${corner.replace('-', ' ')}`}
          title="Resize proportionally"
        />
      ))}
    </section>
  )
}

export function MobilePreviewPanel({ panelId }: { panelId: string }): React.JSX.Element {
  const panel = useBrowserStore((state) => state.panels[panelId])
  const ensure = useBrowserStore((state) => state.ensure)
  const rememberUrl = useBrowserStore((state) => state.rememberUrl)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)

  useEffect(() => {
    ensure(panelId)
  }, [ensure, panelId])

  useEffect(() => {
    if (panel?.url) setInput(panel.url)
  }, [panel?.url])

  const navigate = (raw: string): void => {
    const resolved = resolveBrowserNavigation(raw)
    if (!resolved.ok) {
      setError(resolved.error)
      return
    }
    setError(null)
    setInput(resolved.url)
    rememberUrl(panelId, resolved.url)
  }

  const url = panel?.url ?? ''

  return (
    <div className="mobile-preview-workbench">
      <div className="mobile-preview-chrome">
        <div className="mobile-preview-heading">
          <Smartphone className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span>Mobile preview</span>
        </div>
        <form
          className="browser-omnibox"
          onSubmit={(event) => {
            event.preventDefault()
            navigate(input)
          }}
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="localhost:5173 or a URL"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </form>
        <button
          type="button"
          className="browser-icon-btn"
          onClick={() => setReloadVersion((value) => value + 1)}
          disabled={!url}
          aria-label="Reload both device previews"
          title="Reload both previews"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      {error ? <p className="browser-error">{error}</p> : null}
      {!url ? (
        <div className="mobile-preview-start">
          <Smartphone className="h-7 w-7 text-primary" aria-hidden />
          <h3>Preview your app on two devices</h3>
          <p>Both frames load the same URL with iPhone and Android viewport sizes.</p>
          <div className="browser-presets">
            {LOCAL_BROWSER_PRESETS.map((preset) => (
              <Button key={preset.url} variant="secondary" onClick={() => navigate(preset.url)}>
                :{preset.label}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mobile-preview-stage">
          {DEVICES.map((device) => (
            <MobileDevice key={device.id} device={device} url={url} reloadVersion={reloadVersion} />
          ))}
        </div>
      )}
    </div>
  )
}
