import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Loader2,
  RotateCw,
  Search
} from 'lucide-react'
import {
  BROWSER_VIEWPORTS,
  displayBrowserHost,
  fitViewportScale,
  LOCAL_BROWSER_PRESETS,
  resolveBrowserNavigation,
  viewportWidth
} from '@shared/contracts/browser'
import { useBrowserStore } from '@renderer/stores/browser-store'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { Button } from '@renderer/components/ui/Button'
import { cn } from '@renderer/lib/utils'

type GuestWebview = HTMLElement & {
  src: string
  getURL?: () => string
  getTitle?: () => string
  canGoBack?: () => boolean
  canGoForward?: () => boolean
  goBack?: () => void
  goForward?: () => void
  reload?: () => void
  stop?: () => void
  loadURL?: (url: string) => void
}

function readGuestUrl(guest: GuestWebview | null): string {
  if (!guest) return ''
  try {
    return guest.getURL?.() || guest.getAttribute('src') || ''
  } catch {
    return guest.getAttribute('src') || ''
  }
}

export function BrowserPanel({ panelId }: { panelId: string }): React.JSX.Element {
  const renamePanel = useWorkspaceStore((state) => state.renamePanel)
  const recents = useBrowserStore((state) => state.recents)
  const panel = useBrowserStore((state) => state.panels[panelId])
  const ensure = useBrowserStore((state) => state.ensure)
  const rememberUrl = useBrowserStore((state) => state.rememberUrl)
  const setViewport = useBrowserStore((state) => state.setViewport)
  const setCustomWidth = useBrowserStore((state) => state.setCustomWidth)

  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const guestRef = useRef<GuestWebview | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [stageWidth, setStageWidth] = useState(0)

  useEffect(() => {
    ensure(panelId)
  }, [ensure, panelId])

  useEffect(() => {
    if (panel?.url) setInput(panel.url)
  }, [panel?.url])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = (): void => setStageWidth(stage.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  const currentUrl = panel?.url ?? ''
  const viewport = panel?.viewport ?? 'fluid'
  const customWidth = panel?.customWidth ?? 390
  const frameWidth = viewportWidth(viewport, customWidth)
  const scale = fitViewportScale(Math.max(0, stageWidth - 24), frameWidth)

  const syncChrome = (guest: GuestWebview): void => {
    const nextUrl = readGuestUrl(guest)
    if (nextUrl && nextUrl !== 'about:blank') {
      setInput(nextUrl)
      rememberUrl(panelId, nextUrl)
      const title = guest.getTitle?.() || displayBrowserHost(nextUrl)
      if (title) renamePanel(panelId, title.slice(0, 80))
    }
    setCanBack(Boolean(guest.canGoBack?.()))
    setCanForward(Boolean(guest.canGoForward?.()))
  }

  const navigate = (raw: string): void => {
    const resolved = resolveBrowserNavigation(raw)
    if (!resolved.ok) {
      setError(resolved.error)
      return
    }
    setError(null)
    setInput(resolved.url)
    rememberUrl(panelId, resolved.url)
    const guest = guestRef.current
    if (guest?.loadURL) guest.loadURL(resolved.url)
    else if (guest) guest.setAttribute('src', resolved.url)
  }

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const guest = document.createElement('webview') as GuestWebview
    guest.setAttribute('partition', 'persist:workspace-browser')
    guest.setAttribute('allowpopups', '')
    guest.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no, sandbox=yes')
    guest.className = 'browser-guest'
    const saved = useBrowserStore.getState().ensure(panelId).url
    if (saved) guest.setAttribute('src', saved)
    guestRef.current = guest

    const onStart = (): void => {
      setLoading(true)
      setError(null)
    }
    const onStop = (): void => {
      setLoading(false)
      syncChrome(guest)
    }
    const onFail = (event: Event): void => {
      const detail = event as Event & { errorDescription?: string }
      setLoading(false)
      setError(detail.errorDescription || 'This page failed to load')
    }
    const onNavigate = (): void => syncChrome(guest)

    guest.addEventListener('did-start-loading', onStart)
    guest.addEventListener('did-stop-loading', onStop)
    guest.addEventListener('did-fail-load', onFail)
    guest.addEventListener('did-navigate', onNavigate)
    guest.addEventListener('did-navigate-in-page', onNavigate)
    guest.addEventListener('page-title-updated', onNavigate)
    frame.appendChild(guest)

    return () => {
      guest.removeEventListener('did-start-loading', onStart)
      guest.removeEventListener('did-stop-loading', onStop)
      guest.removeEventListener('did-fail-load', onFail)
      guest.removeEventListener('did-navigate', onNavigate)
      guest.removeEventListener('did-navigate-in-page', onNavigate)
      guest.removeEventListener('page-title-updated', onNavigate)
      guest.remove()
      guestRef.current = null
    }
    // Recreate only when the panel mounts; later moves use loadURL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId])

  const idle = !currentUrl

  return (
    <div className="browser-workbench">
      <div className="browser-chrome">
        <div className="browser-nav">
          <button
            type="button"
            className="browser-icon-btn"
            disabled={!canBack}
            onClick={() => guestRef.current?.goBack?.()}
            aria-label="Back"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="browser-icon-btn"
            disabled={!canForward}
            onClick={() => guestRef.current?.goForward?.()}
            aria-label="Forward"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="browser-icon-btn"
            onClick={() => guestRef.current?.reload?.()}
            aria-label="Reload"
            disabled={idle}
          >
            <RotateCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
        <form
          className="browser-omnibox"
          onSubmit={(event) => {
            event.preventDefault()
            navigate(input)
          }}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="localhost:5173, a URL, or search"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </form>
        <div className="browser-viewports" role="tablist" aria-label="Viewport">
          {BROWSER_VIEWPORTS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={viewport === item.id}
              className={cn('browser-vp', viewport === item.id && 'is-active')}
              onClick={() => setViewport(panelId, item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {viewport === 'custom' && (
          <label className="browser-width">
            <span>W</span>
            <input
              type="number"
              min={240}
              max={2560}
              value={customWidth}
              onChange={(event) => setCustomWidth(panelId, Number(event.target.value))}
            />
          </label>
        )}
        <span className="browser-size">
          {frameWidth ? `${frameWidth}px` : stageWidth > 0 ? `${stageWidth}px` : 'Fluid'}
          {scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}
        </span>
      </div>
      {error && <p className="browser-error">{error}</p>}

      <div ref={stageRef} className={cn('browser-stage', idle && 'is-idle')}>
        {idle && (
          <div className="browser-start">
            <Globe className="h-6 w-6 text-primary" />
            <h3>Preview a local app or research in here</h3>
            <p>Open a running localhost server, then shrink the workspace window to check the layout.</p>
            <div className="browser-presets">
              {LOCAL_BROWSER_PRESETS.map((preset) => (
                <Button key={preset.url} variant="secondary" onClick={() => navigate(preset.url)}>
                  :{preset.label}
                </Button>
              ))}
            </div>
            {recents.length > 0 && (
              <div className="browser-recents">
                {recents.slice(0, 6).map((url) => (
                  <button key={url} type="button" onClick={() => navigate(url)}>
                    {displayBrowserHost(url)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div
          className={cn('browser-frame', viewport !== 'fluid' && 'is-device')}
          style={
            frameWidth
              ? {
                  width: frameWidth,
                  height: `${100 / scale}%`,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top center'
                }
              : undefined
          }
        >
          <div ref={frameRef} className="browser-guest-host" />
        </div>
      </div>
    </div>
  )
}
