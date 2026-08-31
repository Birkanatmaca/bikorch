import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { PtyCreateResponse, PtyEvent, PtyKind, PtyLaunchMode } from '@shared/contracts/pty'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import {
  AI_ACCOUNTS_REFRESH_EVENT,
  AI_ACCOUNT_AUTHENTICATED_EVENT,
  FOCUS_TERMINAL_EVENT,
  TERMINAL_LAYOUT_LOCK_EVENT
} from '@renderer/lib/app-events'
import { getTerminalOptions } from '@renderer/lib/terminal-theme'
import {
  inferCliActivity,
  isCliKind,
  isInterrupt,
  isPromptSubmit,
  mapProcessStatus
} from '@renderer/lib/cli-activity'

interface TerminalViewProps {
  sessionId: string
  kind: PtyKind
  launchMode?: PtyLaunchMode
  accountId?: string
}

const MIN_COLS = 20
const MIN_ROWS = 6
const PTY_RESIZE_MS = 140

export function TerminalView({
  sessionId,
  kind,
  launchMode = 'normal',
  accountId
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const initializedRef = useRef(false)
  const disposedRef = useRef(false)
  const fitFrameRef = useRef<number | null>(null)

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const project = useWorkspaceStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId)
  )
  const setStatus = useTerminalStore((s) => s.setStatus)
  const removeSession = useTerminalStore((s) => s.removeSession)
  const clearPanelLaunchMode = useWorkspaceStore((s) => s.clearPanelLaunchMode)
  const sessionError = useTerminalStore((s) => s.errors[sessionId])
  const [installPrompt, setInstallPrompt] = useState<'cursor' | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const startSessionRef = useRef<(terminal: Terminal) => Promise<void>>(async () => {})

  const layoutLockedRef = useRef(false)
  const lastSizeRef = useRef({ cols: 0, rows: 0 })
  const ptyResizeTimerRef = useRef<number | null>(null)

  const fitTerminal = useCallback((sendPty = true, immediate = false) => {
    if (disposedRef.current) return

    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    const container = containerRef.current
    if (!terminal || !fitAddon || !container) return
    if (layoutLockedRef.current) return

    const { clientWidth, clientHeight } = container
    if (clientWidth < 80 || clientHeight < 40) return

    try {
      const proposed = fitAddon.proposeDimensions()
      if (!proposed) return

      const cols = Math.max(MIN_COLS, Math.min(400, proposed.cols))
      const rows = Math.max(MIN_ROWS, Math.min(200, proposed.rows))
      if (cols === lastSizeRef.current.cols && rows === lastSizeRef.current.rows) {
        return
      }

      terminal.resize(cols, rows)
      lastSizeRef.current = { cols, rows }

      if (!sendPty) return
      if (ptyResizeTimerRef.current !== null) {
        window.clearTimeout(ptyResizeTimerRef.current)
        ptyResizeTimerRef.current = null
      }
      if (immediate) {
        void window.api.pty.resize({ sessionId, cols, rows })
        return
      }
      ptyResizeTimerRef.current = window.setTimeout(() => {
        ptyResizeTimerRef.current = null
        if (disposedRef.current) return
        void window.api.pty.resize({ sessionId, cols, rows })
      }, PTY_RESIZE_MS)
    } catch {
      // xterm can throw if the renderer is not ready yet
    }
  }, [sessionId])

  const scheduleFit = useCallback(() => {
    if (disposedRef.current) return
    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current)
    }
    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null
      fitTerminal()
    })
  }, [fitTerminal])

  useEffect(() => {
    const container = containerRef.current
    if (!container || initializedRef.current) return
    initializedRef.current = true
    disposedRef.current = false
    const projectIdAtMount = activeProjectId
    const folderPathAtMount = project?.folderPath ?? null

    const terminal = new Terminal(getTerminalOptions(kind))

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    setStatus(sessionId, 'starting')

    const cli = isCliKind(kind)
    let outputTail = ''
    let idleTimer: number | null = null
    let authInspectTimer: number | null = null
    let authCaptured = false
    let receivedSinceBusy = false

    const inspectAuthenticatedProfile = async (): Promise<void> => {
      if (launchMode !== 'login' || !accountId || kind === 'terminal' || authCaptured) return
      const emailMatches = outputTail.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)
      const email = emailMatches?.at(-1)
      const request = { kind, accountId, ...(email ? { email } : {}) }
      const result =
        kind === 'antigravity' && email
          ? await window.api.authProfiles.importCurrent(request)
          : await window.api.authProfiles.inspect(request)
      if (!result.ready) return
      authCaptured = true
      window.dispatchEvent(
        new CustomEvent(AI_ACCOUNT_AUTHENTICATED_EVENT, {
          detail: { accountId, kind, identity: result.identity }
        })
      )
      window.dispatchEvent(new Event(AI_ACCOUNTS_REFRESH_EVENT))
    }

    const scheduleAuthInspect = (): void => {
      if (launchMode !== 'login' || !accountId || authCaptured) return
      if (authInspectTimer !== null) window.clearTimeout(authInspectTimer)
      authInspectTimer = window.setTimeout(() => {
        authInspectTimer = null
        void inspectAuthenticatedProfile()
      }, 900)
    }

    const applyCliStatus = (next: 'waiting' | 'busy'): void => {
      const current = useTerminalStore.getState().getStatus(sessionId)
      if (current === 'stopped' || current === 'error') return
      if (next === 'busy') receivedSinceBusy = current === 'busy' ? receivedSinceBusy : false
      if (current === next) return
      setStatus(sessionId, next)
    }

    const noteOutput = (chunk: string): void => {
      if (!cli) return
      outputTail = (outputTail + chunk).slice(-4000)
      const inferred = inferCliActivity(outputTail)
      const current = useTerminalStore.getState().getStatus(sessionId)
      if (current === 'busy') receivedSinceBusy = true

      if (inferred === 'busy') {
        applyCliStatus('busy')
        if (idleTimer !== null) {
          window.clearTimeout(idleTimer)
          idleTimer = null
        }
        return
      }
      if (inferred === 'waiting') {
        applyCliStatus('waiting')
        return
      }

      if (current !== 'busy' || !receivedSinceBusy) return
      if (idleTimer !== null) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        idleTimer = null
        if (inferCliActivity(outputTail) !== 'busy') {
          applyCliStatus('waiting')
        }
      }, 1800)
    }

    const unsubscribe = window.api.pty.onEvent((event: PtyEvent) => {
      if (event.sessionId !== sessionId) return

      switch (event.type) {
        case 'data':
          terminal.write(event.data)
          noteOutput(event.data)
          scheduleAuthInspect()
          break
        case 'status':
          if (event.status === 'stopped') break
          if (event.status === 'running' || event.status === 'starting') {
            const current = useTerminalStore.getState().getStatus(sessionId)
            if (current === 'busy' || current === 'waiting') break
          }
          setStatus(sessionId, mapProcessStatus(kind, event.status), event.error)
          if (event.status === 'error' && event.error) {
            terminal.writeln(`\r\n\x1b[31m[Error] ${event.error}\x1b[0m`)
          }
          break
        case 'exit':
          if (idleTimer !== null) {
            window.clearTimeout(idleTimer)
            idleTimer = null
          }
          setStatus(sessionId, 'stopped')
          terminal.writeln(`\r\n\x1b[90m[Process exited with code ${event.exitCode}]\x1b[0m`)
          if (launchMode === 'login') {
            void inspectAuthenticatedProfile()
            window.dispatchEvent(new Event(AI_ACCOUNTS_REFRESH_EVENT))
          }
          break
      }
    })

    terminal.onData((data) => {
      void window.api.pty.write({ sessionId, data })
      if (!cli) return
      if (isInterrupt(data)) {
        applyCliStatus('waiting')
        return
      }
      if (isPromptSubmit(data)) {
        applyCliStatus('busy')
      }
    })

    const startSession = async (term: Terminal): Promise<void> => {
      if (kind === 'cursor' && window.api.cli) {
        const detected = await window.api.cli.detect('cursor')
        if (!detected.installed) {
          setInstallPrompt('cursor')
          setStatus(sessionId, 'error', 'Cursor CLI is not installed')
          return
        }
      }

      const cwd = project?.folderPath ?? ''
      const result: PtyCreateResponse = await window.api.pty.create({
        sessionId,
        cwd,
        kind,
        cols: term.cols,
        rows: term.rows,
        launchMode,
        accountId
      })
      if (launchMode === 'login') {
        clearPanelLaunchMode(sessionId)
      }
      setStatus(sessionId, mapProcessStatus(kind, result.status), result.error)
      if (result.status === 'error' && result.error) {
        term.writeln(`\x1b[31m[Error] ${result.error}\x1b[0m`)
        if (result.code === 'CLI_MISSING' && kind === 'cursor') {
          setInstallPrompt('cursor')
        }
      }
    }

    startSessionRef.current = startSession

    const focusThis = (): void => {
      terminal.focus()
    }

    const onFocusRequest = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      if (id === sessionId) focusThis()
    }

    const onLayoutLock = (event: Event): void => {
      const detail = (event as CustomEvent<{ panelId: string | null; locked: boolean }>).detail
      if (detail.panelId && detail.panelId !== sessionId) return
      if (detail.locked) {
        layoutLockedRef.current = true
        return
      }
      window.setTimeout(() => {
        layoutLockedRef.current = false
        if (!disposedRef.current) fitTerminal(true, true)
      }, 180)
    }

    container.addEventListener('pointerdown', focusThis)
    window.addEventListener(FOCUS_TERMINAL_EVENT, onFocusRequest)
    window.addEventListener(TERMINAL_LAYOUT_LOCK_EVENT, onLayoutLock)

    const resizeObserver = new ResizeObserver(() => {
      scheduleFit()
    })
    resizeObserver.observe(container)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitTerminal(false)
        void startSession(terminal)
        focusThis()
      })
    })

    return () => {
      disposedRef.current = true
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current)
        fitFrameRef.current = null
      }
      if (ptyResizeTimerRef.current !== null) {
        window.clearTimeout(ptyResizeTimerRef.current)
        ptyResizeTimerRef.current = null
      }
      if (idleTimer !== null) window.clearTimeout(idleTimer)
      if (authInspectTimer !== null) window.clearTimeout(authInspectTimer)
      resizeObserver.disconnect()
      container.removeEventListener('pointerdown', focusThis)
      window.removeEventListener(FOCUS_TERMINAL_EVENT, onFocusRequest)
      window.removeEventListener(TERMINAL_LAYOUT_LOCK_EVENT, onLayoutLock)
      unsubscribe()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      initializedRef.current = false

      // Switching projects unmounts the visible panel, but the PTY remains alive.
      // Renderer-only state is cleared when the panel was actually removed.
      const workspaceAtCleanup = projectIdAtMount
        ? useWorkspaceStore.getState().workspaces[projectIdAtMount]
        : undefined
      const panelStillExists =
        workspaceAtCleanup?.panels.some((panel) => panel.id === sessionId) ?? false
      const currentFolderPath = projectIdAtMount
        ? useWorkspaceStore
            .getState()
            .projects.find((workspaceProject) => workspaceProject.id === projectIdAtMount)
            ?.folderPath ?? null
        : null

      if (!panelStillExists || currentFolderPath !== folderPathAtMount) {
        void window.api.pty.kill({ sessionId })
      }
      if (!panelStillExists) removeSession(sessionId)
    }
  }, [sessionId, kind, accountId, project?.folderPath, setStatus, removeSession, clearPanelLaunchMode, scheduleFit, fitTerminal])

  // Refit when project tab becomes active again
  useEffect(() => {
    if (!activeProjectId) return
    const timer = setTimeout(scheduleFit, 100)
    return () => clearTimeout(timer)
  }, [activeProjectId, scheduleFit])

  const handleInstall = async (): Promise<void> => {
    if (!window.api.cli) return
    setInstalling(true)
    setInstallMessage('Cursor CLI yükleniyor...')
    const result = await window.api.cli.install('cursor')
    setInstalling(false)
    if (!result.ok) {
      setInstallMessage(result.error ?? 'Yükleme başarısız')
      return
    }
    setInstallPrompt(null)
    setInstallMessage(null)
    const terminal = terminalRef.current
    if (terminal) {
      void startSessionRef.current(terminal)
    }
  }

  return (
    <div
      className={
        isCliKind(kind)
          ? 'relative h-full min-h-0 w-full bg-app-bg px-1.5 py-1 app-no-drag'
          : 'relative h-full min-h-0 w-full bg-app-bg px-2 py-1.5 app-no-drag'
      }
      data-terminal-session={sessionId}
      onPointerDown={() => terminalRef.current?.focus()}
    >
      <div ref={containerRef} className="h-full min-h-0 w-full overflow-hidden" />
      {installPrompt === 'cursor' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-app-bg/80 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-elevated p-4 shadow-xl">
            <p className="text-sm font-medium text-text-primary">Cursor CLI bulunamadı</p>
            <p className="mt-2 text-xs leading-relaxed text-text-secondary">
              Bu bilgisayarda Cursor CLI yüklü değil veya bulunamadı. Şimdi resmi kurulumu
              çalıştırmamı ister misin?
            </p>
            {installMessage && (
              <p className="mt-2 text-[11px] text-warning">{installMessage}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={installing}
                onClick={() => setInstallPrompt(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-hover"
              >
                Hayır
              </button>
              <button
                type="button"
                disabled={installing}
                onClick={() => void handleInstall()}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {installing ? 'Yükleniyor...' : 'Evet, yükle'}
              </button>
            </div>
          </div>
        </div>
      )}
      {sessionError && !installPrompt && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-error/10 px-2 py-1 font-mono text-[10px] text-error">
          {sessionError}
        </div>
      )}
    </div>
  )
}
