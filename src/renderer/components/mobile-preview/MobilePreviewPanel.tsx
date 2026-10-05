import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, Check, ChevronDown, Loader2, RefreshCw, Search, Smartphone, Square, Video, X } from 'lucide-react'
import {
  LOCAL_BROWSER_PRESETS,
  resolveBrowserNavigation
} from '@shared/contracts/browser'
import {
  mobileDeviceAspect,
  mobileDeviceGeometry,
  mobileModelsFor,
  resolveMobileModel,
  type MobileDeviceGeometry,
  type MobileDeviceModel,
  type MobilePlatform
} from '@shared/mobile-devices'
import { useBrowserStore } from '@renderer/stores/browser-store'
import { Button } from '@renderer/components/ui/Button'
import { cn } from '@renderer/lib/utils'
import { CanvasDeviceInteractionContext } from '@renderer/components/mobile-preview/canvas-device-context'

type GuestWebview = HTMLElement & {
  src: string
  reload?: () => void
  setZoomFactor?: (factor: number) => void
  capturePage?: () => Promise<{ toDataURL: () => string }>
}

const CAPTURE_SCALE = 1.5
/** Side buttons stick out of the frame; keep room so they are not clipped. */
const BUTTON_ROOM = 4
/** Size of a device in the two-device panel before the user resizes it. */
const PANEL_DEVICE_HEIGHT = 560

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

function drawCutout(context: CanvasRenderingContext2D, model: MobileDeviceModel, geometry: MobileDeviceGeometry): void {
  const { cutout } = geometry
  context.fillStyle = '#030405'
  if (model.cutout === 'notch') {
    const { x, y, w, h, r } = cutout
    context.beginPath()
    context.moveTo(x - 6, y)
    context.quadraticCurveTo(x, y, x, y + 6)
    context.lineTo(x, y + h - r)
    context.quadraticCurveTo(x, y + h, x + r, y + h)
    context.lineTo(x + w - r, y + h)
    context.quadraticCurveTo(x + w, y + h, x + w, y + h - r)
    context.lineTo(x + w, y + 6)
    context.quadraticCurveTo(x + w, y, x + w + 6, y)
    context.closePath()
    context.fill()
    return
  }
  if (model.cutout === 'home-button') {
    roundedRect(context, cutout.x, cutout.y, cutout.w, cutout.h, cutout.r)
    context.fill()
    if (geometry.homeButton) {
      const { cx, cy, r } = geometry.homeButton
      context.beginPath()
      context.arc(cx, cy, r, 0, Math.PI * 2)
      context.strokeStyle = 'rgba(0,0,0,0.22)'
      context.lineWidth = 2.5
      context.stroke()
    }
    return
  }
  roundedRect(context, cutout.x, cutout.y, cutout.w, cutout.h, cutout.r)
  context.fill()
}

async function renderFramedDevice(guest: GuestWebview, model: MobileDeviceModel): Promise<HTMLCanvasElement> {
  if (!guest.capturePage) throw new Error('Screen capture is not available yet')
  const nativeImage = await guest.capturePage()
  const screenImage = await imageFromDataUrl(nativeImage.toDataURL())
  const geometry = mobileDeviceGeometry(model)
  const { frame, screen } = geometry
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(frame.w * CAPTURE_SCALE)
  canvas.height = Math.round(frame.h * CAPTURE_SCALE)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create recording canvas')
  context.scale(CAPTURE_SCALE, CAPTURE_SCALE)

  roundedRect(context, 1, 1, frame.w - 2, frame.h - 2, frame.r)
  const shell = context.createLinearGradient(0, 0, frame.w, frame.h)
  shell.addColorStop(0, model.finish.shine)
  shell.addColorStop(0.08, model.finish.edge)
  shell.addColorStop(0.5, model.finish.body)
  shell.addColorStop(0.92, model.finish.edge)
  shell.addColorStop(1, model.finish.shine)
  context.fillStyle = shell
  context.fill()
  roundedRect(context, 4, 4, frame.w - 8, frame.h - 8, Math.max(0, frame.r - 3))
  context.fillStyle = model.cutout === 'home-button' ? model.finish.body : '#050608'
  context.fill()

  context.save()
  roundedRect(context, screen.x, screen.y, screen.w, screen.h, screen.r)
  context.clip()
  context.fillStyle = '#ffffff'
  context.fillRect(screen.x, screen.y, screen.w, screen.h)
  context.drawImage(screenImage, screen.x, screen.y, screen.w, screen.h)
  context.restore()

  drawCutout(context, model, geometry)
  if (geometry.indicator) {
    const { x, y, w, h, r } = geometry.indicator
    context.fillStyle = 'rgba(20,20,22,0.85)'
    roundedRect(context, x, y, w, h, r)
    context.fill()
  }
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

function captureFileName(model: MobileDeviceModel, extension: 'png' | 'webm'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  return `bikorch-${model.id}-${stamp}.${extension}`
}

function viewportLabel(model: MobileDeviceModel): string {
  return `${model.viewport.w} × ${model.viewport.h} · @${model.dpr}x`
}

function ModelPicker({
  platform,
  model,
  onChange,
  compact = false
}: {
  platform: MobilePlatform
  model: MobileDeviceModel
  onChange: (id: string) => void
  compact?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('device-model-picker', compact && 'is-compact')}>
      <button
        type="button"
        className="device-model-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title="Choose device model"
      >
        <Smartphone className="h-3.5 w-3.5" aria-hidden />
        <span>
          <strong>{model.name}</strong>
          {!compact ? <small>{viewportLabel(model)}</small> : null}
        </span>
        <ChevronDown className="h-3 w-3" aria-hidden />
      </button>
      {open ? (
        <ul className="device-model-menu" role="listbox" aria-label={`${platform === 'ios' ? 'iOS' : 'Android'} models`}>
          {mobileModelsFor(platform).map((item) => {
            const aspect = mobileDeviceAspect(item)
            return (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.id === model.id}
                  className={cn(item.id === model.id && 'is-selected')}
                  onClick={() => {
                    onChange(item.id)
                    setOpen(false)
                  }}
                >
                  <i
                    className={cn('device-model-glyph', `is-${item.cutout}`)}
                    style={{ width: `${Math.round(22 * aspect)}px` }}
                    aria-hidden
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{viewportLabel(item)}</small>
                  </span>
                  {item.id === model.id ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function px(value: number, scale: number): string {
  return `${value * scale}px`
}

function MobileDevice({
  model,
  url,
  reloadVersion,
  canvas = false,
  empty,
  onModelChange,
  onAspectChange
}: {
  model: MobileDeviceModel
  url: string
  reloadVersion: number
  canvas?: boolean
  empty?: ReactNode
  onModelChange: (id: string) => void
  onAspectChange?: (aspect: number) => void
}): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const guestRef = useRef<GuestWebview | null>(null)
  const aspectRef = useRef(onAspectChange)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [panelScale, setPanelScale] = useState(1)
  const recordingRef = useRef<{ recorder: MediaRecorder; interval: number } | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const geometry = mobileDeviceGeometry(model)
  const { frame, screen } = geometry
  const aspect = frame.w / frame.h

  aspectRef.current = onAspectChange

  useLayoutEffect(() => {
    const element = boxRef.current
    if (!element) return
    const measure = (): void => {
      const rect = element.getBoundingClientRect()
      setBox((current) => (current.w === rect.width && current.h === rect.height ? current : { w: rect.width, h: rect.height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!canvas || box.w <= 0 || box.h <= 0) return
    if (Math.abs(box.w / box.h - aspect) / aspect > 0.015) aspectRef.current?.(aspect)
  }, [aspect, box.h, box.w, canvas])

  const buttonRoom = canvas ? 0 : BUTTON_ROOM * 2
  const scale = box.w > 0 && box.h > 0
    ? Math.max(0.05, Math.min((box.w - buttonRoom) / frame.w, box.h / frame.h))
    : 0
  /** The screen host only exists once the box is measured; the guest must wait for it. */
  const measured = scale > 0

  const beginPanelResize = (event: React.PointerEvent<HTMLButtonElement>, xDirection: 1 | -1): void => {
    event.preventDefault()
    event.stopPropagation()
    const startY = event.clientY
    const startX = event.clientX
    const startScale = panelScale
    const onMove = (moveEvent: PointerEvent): void => {
      const vertical = moveEvent.clientY - startY
      const horizontal = ((moveEvent.clientX - startX) * xDirection) / aspect
      const delta = (vertical + horizontal) / 2
      setPanelScale(Math.min(1.8, Math.max(0.5, startScale + delta / PANEL_DEVICE_HEIGHT)))
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
    guest.setAttribute('useragent', model.userAgent)
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
        // The guest is laid out at the exact CSS viewport and scaled visually, so it must not zoom.
        guest.setZoomFactor?.(1)
      } catch {
        // Older guests ignore zoom; layout already uses the device viewport.
      }
    }
    const onFail = (event: Event): void => {
      const detail = event as Event & { isMainFrame?: boolean; errorCode?: number }
      // -3 is an aborted load, which redirects and fast reloads produce.
      if (detail.isMainFrame === false || detail.errorCode === -3) return
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
  }, [measured, model.userAgent, url])

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
      const output = await renderFramedDevice(guest, model)
      const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not encode screenshot')
      downloadBlob(blob, captureFileName(model, 'png'))
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
      const output = await renderFramedDevice(guest, model)
      const stream = output.captureStream(8)
      const chunks: BlobPart[] = []
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? { mimeType: 'video/webm;codecs=vp9' }
        : { mimeType: 'video/webm' })
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        if (chunks.length > 0) downloadBlob(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }), captureFileName(model, 'webm'))
      }
      const paint = async (): Promise<void> => {
        if (!recordingRef.current) return
        try {
          const next = await renderFramedDevice(guest, model)
          const context = output.getContext('2d')
          context?.clearRect(0, 0, output.width, output.height)
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

  const captureActions = (
    <>
      {loading || capturing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-label="Loading" /> : null}
      <button type="button" onClick={() => void takeScreenshot()} disabled={!url || capturing || recording} title="Save framed screenshot" aria-label={`Save ${model.name} screenshot`}>
        <Camera className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => (recording ? stopRecording() : void startRecording())} disabled={!url || capturing} title={recording ? 'Stop recording' : 'Record framed video'} aria-label={recording ? `Stop ${model.name} recording` : `Record ${model.name} video`} className={cn(recording && 'is-recording')}>
        {recording ? <Square className="h-3 w-3" /> : <Video className="h-3.5 w-3.5" />}
      </button>
    </>
  )

  const panelHeight = PANEL_DEVICE_HEIGHT * panelScale
  const homeButton = geometry.homeButton

  return (
    <section
      className={cn('mobile-device', `mobile-device-${model.platform}`, canvas && 'is-canvas-device')}
      aria-label={`${model.name} preview`}
    >
      {!canvas ? (
        <div className="mobile-device-meta">
          <ModelPicker platform={model.platform} model={model} onChange={onModelChange} />
          <div className="mobile-device-actions">{captureActions}</div>
        </div>
      ) : null}
      <div
        ref={boxRef}
        className="mobile-device-box"
        style={canvas ? undefined : { width: `${panelHeight * aspect + BUTTON_ROOM * 2}px`, height: `${panelHeight}px` }}
      >
        {scale > 0 ? (
          <div
            className={cn('device-frame', `is-${model.cutout}`)}
            style={{
              width: px(frame.w, scale),
              height: px(frame.h, scale),
              borderRadius: px(frame.r, scale),
              '--device-edge': model.finish.edge,
              '--device-body': model.finish.body,
              '--device-shine': model.finish.shine
            } as React.CSSProperties}
          >
            {geometry.buttons.map((button, index) => (
              <span
                key={index}
                className={cn('device-side-button', `is-${button.side}`)}
                style={{ top: px(button.y, scale), height: px(button.h, scale) }}
                aria-hidden
              />
            ))}
            <div className="device-bezel" style={{ borderRadius: px(Math.max(0, frame.r - 3), scale) }} />
            <div
              className="mobile-device-screen"
              style={{
                left: px(screen.x, scale),
                top: px(screen.y, scale),
                width: px(screen.w, scale),
                height: px(screen.h, scale),
                borderRadius: px(screen.r, scale)
              }}
            >
              <div
                ref={hostRef}
                className="mobile-device-viewport-host"
                style={{ width: `${screen.w}px`, height: `${screen.h}px`, transform: `scale(${scale})` }}
              />
              {empty ? <div className="mobile-device-empty">{empty}</div> : null}
            </div>
            <span
              className={cn('device-cutout', `is-${model.cutout}`)}
              style={{
                left: px(geometry.cutout.x, scale),
                top: px(geometry.cutout.y, scale),
                width: px(geometry.cutout.w, scale),
                height: px(geometry.cutout.h, scale),
                borderRadius: model.cutout === 'notch'
                  ? `0 0 ${px(geometry.cutout.r, scale)} ${px(geometry.cutout.r, scale)}`
                  : px(geometry.cutout.r, scale)
              }}
              aria-hidden
            />
            {homeButton ? (
              <span
                className="device-home-button"
                style={{
                  left: px(homeButton.cx - homeButton.r, scale),
                  top: px(homeButton.cy - homeButton.r, scale),
                  width: px(homeButton.r * 2, scale),
                  height: px(homeButton.r * 2, scale)
                }}
                aria-hidden
              />
            ) : null}
            {geometry.indicator ? (
              <span
                className="device-home-indicator"
                style={{
                  left: px(geometry.indicator.x, scale),
                  top: px(geometry.indicator.y, scale),
                  width: px(geometry.indicator.w, scale),
                  height: px(Math.max(geometry.indicator.h, 3 / scale), scale)
                }}
                aria-hidden
              />
            ) : null}
            {failed ? <span className="mobile-device-failed">Could not load</span> : null}
            {canvas ? (
              <div className="mobile-device-actions is-overlay">{captureActions}</div>
            ) : null}
          </div>
        ) : null}
        {!canvas
          ? ([-1, 1] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                className={cn('mobile-device-resize-handle', direction === 1 ? 'is-bottom-right' : 'is-bottom-left')}
                onPointerDown={(event) => beginPanelResize(event, direction)}
                aria-label={`Resize ${model.name}`}
                title="Drag to resize. The device keeps its real proportions."
              />
            ))
          : null}
      </div>
      {!canvas ? <span className="mobile-device-viewport">CSS viewport {viewportLabel(model)}</span> : null}
    </section>
  )
}

export function MobilePreviewPanel({ panelId, deviceId }: { panelId: string; deviceId?: MobilePlatform }): React.JSX.Element {
  const canvas = useContext(CanvasDeviceInteractionContext)
  const panel = useBrowserStore((state) => state.panels[panelId])
  const ensure = useBrowserStore((state) => state.ensure)
  const rememberUrl = useBrowserStore((state) => state.rememberUrl)
  const setDeviceModel = useBrowserStore((state) => state.setDeviceModel)
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
  const platforms: MobilePlatform[] = deviceId ? [deviceId] : ['ios', 'android']
  const models = platforms.map((platform) => resolveMobileModel(platform, panel?.deviceModels?.[platform]))
  const direct = Boolean(deviceId)
  const canvasDevice = direct
  const primary = models[0]

  const startCopy = (
    <div className={cn('mobile-preview-start', canvasDevice && 'is-on-device')}>
      <Smartphone className="h-7 w-7 text-primary" aria-hidden />
      <h3>{direct ? `Preview on ${primary.name}` : 'Preview your app on two devices'}</h3>
      <p>
        {direct
          ? `The page renders at the real ${primary.viewport.w} × ${primary.viewport.h} CSS viewport with a mobile user agent.`
          : 'Both frames load the same URL at real iPhone and Android viewport sizes.'}
      </p>
      <div className="browser-presets">
        {LOCAL_BROWSER_PRESETS.map((preset) => (
          <Button key={preset.url} variant="secondary" onClick={() => navigate(preset.url)}>
            :{preset.label}
          </Button>
        ))}
      </div>
    </div>
  )

  return (
    <div className={cn(
      'mobile-preview-workbench',
      canvasDevice ? 'mobile-canvas-device' : direct && 'mobile-direct-workspace',
      canvasDevice && !url && 'is-awaiting-url'
    )}>
      <div className="mobile-preview-chrome">
        {!canvasDevice ? (
          <div className="mobile-preview-heading">
            <Smartphone className="h-3.5 w-3.5 text-primary" aria-hidden />
            <span>Mobile preview</span>
          </div>
        ) : null}
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
          aria-label={direct ? 'Reload device preview' : 'Reload both device previews'}
          title={direct ? 'Reload device' : 'Reload both previews'}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        {canvas?.onClose ? (
          <button type="button" className="browser-icon-btn" onClick={canvas.onClose} aria-label="Close device" title="Close device">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {canvasDevice ? (
          <div className="mobile-canvas-model-row">
            <ModelPicker
              platform={primary.platform}
              model={primary}
              compact
              onChange={(id) => setDeviceModel(panelId, primary.platform, id)}
            />
            <span>{viewportLabel(primary)}</span>
          </div>
        ) : null}
      </div>
      {error ? <p className="browser-error">{error}</p> : null}
      {canvasDevice ? (
        <div className="mobile-preview-stage">
          <MobileDevice
            key={primary.id}
            model={primary}
            url={url}
            reloadVersion={reloadVersion}
            canvas
            empty={url ? null : startCopy}
            onModelChange={(id) => setDeviceModel(panelId, primary.platform, id)}
            onAspectChange={canvas?.onAspectChange}
          />
        </div>
      ) : !url ? (
        startCopy
      ) : (
        <div className="mobile-preview-stage">
          {models.map((model) => (
            <MobileDevice
              key={model.platform}
              model={model}
              url={url}
              reloadVersion={reloadVersion}
              onModelChange={(id) => setDeviceModel(panelId, model.platform, id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
