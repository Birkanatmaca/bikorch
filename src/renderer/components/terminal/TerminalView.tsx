import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentWorktreeKind } from '@shared/contracts/git'
import { AGENT_WORKTREE_KINDS } from '@shared/contracts/git'
import type { PtyCreateResponse, PtyEvent, PtyKind, PtyLaunchMode } from '@shared/contracts/pty'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { useIsolationStore } from '@renderer/stores/isolation-store'
import {
  AI_ACCOUNTS_REFRESH_EVENT,
  AI_ACCOUNT_AUTHENTICATED_EVENT,
  FOCUS_TERMINAL_EVENT,
  TERMINAL_LAYOUT_LOCK_EVENT
} from '@renderer/lib/app-events'
import { getTerminalOptions } from '@renderer/lib/terminal-theme'
import { Button } from '@renderer/components/ui/Button'
import {
  inferCliActivity,
  isCliKind,
  isInterrupt,
  isPromptSubmit,
  looksCliSignedIn,
  mapProcessStatus
} from '@renderer/lib/cli-activity'
import { PromptComposer, isLikelyPrompt } from '@renderer/lib/prompt-capture'
import { formatMemoryContextBlock } from '@renderer/lib/developer-context'
import {
  beginAgentSession,
  endAgentSession,
  finalizeAgentSession,
  notePromptInSession,
  noteSessionContext,
  recordPromptSent,
  resumeAgentSession
} from '@renderer/lib/developer-events'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'

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
    // Developer Intelligence: rebuild the composed prompt from keystrokes (CLI agents only).
    const composer = cli ? new PromptComposer() : null
    const agentKind = kind as Exclude<PtyKind, 'terminal'>
    let outputTail = ''
    let idleTimer: number | null = null
    let authInspectTimer: number | null = null
    let authPollTimer: number | null = null
    let authCaptured = false
    let authCaptureInFlight = false
    let lastAuthCaptureError: string | null = null
    let receivedSinceBusy = false
    const captureAfterLogin = launchMode === 'login'
    const shouldCaptureAccount =
      Boolean(accountId) && (captureAfterLogin || kind === 'antigravity')

    const inspectAuthenticatedProfile = async (): Promise<void> => {
      if (
        !shouldCaptureAccount ||
        !accountId ||
        kind === 'terminal' ||
        authCaptured ||
        authCaptureInFlight
      ) {
        return
      }
      const emailMatches = outputTail.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)
      const email = emailMatches?.at(-1)
      const signedIn = looksCliSignedIn(kind, outputTail)
      if (kind === 'antigravity' && !email) return
      // Cursor capture reads only this profile's credential file and verifies it with the server.
      // Do not depend on CLI output wording to detect a completed login.

      authCaptureInFlight = true
      try {
        const request = {
          kind,
          accountId,
          ...(email ? { email } : {}),
          ...(kind === 'cursor' && signedIn ? { signedIn: true } : {})
        }
        const result =
          kind === 'antigravity' || kind === 'cursor'
            ? await window.api.authProfiles.importCurrent(request)
            : await window.api.authProfiles.inspect(request)
        if (!result.ok) {
          const message = result.error ?? 'Could not save this CLI account session'
          if (message !== lastAuthCaptureError) {
            lastAuthCaptureError = message
            terminal.writeln(`\r\n\x1b[33m[Account] ${message}\x1b[0m`)
          }
          return
        }
        if (!result.ready) return
        authCaptured = true
        if (authPollTimer !== null) {
          window.clearInterval(authPollTimer)
          authPollTimer = null
        }
        window.dispatchEvent(
          new CustomEvent(AI_ACCOUNT_AUTHENTICATED_EVENT, {
            detail: { accountId, kind, identity: result.identity }
          })
        )
        window.dispatchEvent(new Event(AI_ACCOUNTS_REFRESH_EVENT))
      } catch (captureError) {
        const message =
          captureError instanceof Error
            ? captureError.message
            : 'Could not save this CLI account session'
        if (message !== lastAuthCaptureError) {
          lastAuthCaptureError = message
          terminal.writeln(`\r\n\x1b[33m[Account] ${message}\x1b[0m`)
        }
      } finally {
        authCaptureInFlight = false
      }
    }

    const scheduleAuthInspect = (): void => {
      if (!shouldCaptureAccount || authCaptured) return
      if (authInspectTimer !== null) window.clearTimeout(authInspectTimer)
      authInspectTimer = window.setTimeout(() => {
        authInspectTimer = null
        void inspectAuthenticatedProfile()
      }, kind === 'antigravity' || kind === 'cursor' ? 1600 : 900)
    }

    if (kind === 'cursor' && captureAfterLogin && shouldCaptureAccount) {
      authPollTimer = window.setInterval(() => {
        void inspectAuthenticatedProfile()
      }, 2000)
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
      outputTail = (outputTail + chunk).slice(-8000)
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
          if (cli) endAgentSession(sessionId, event.exitCode, 'exited')
          setStatus(sessionId, 'stopped')
          terminal.writeln(`\r\n\x1b[90m[Process exited with code ${event.exitCode}]\x1b[0m`)
          if (shouldCaptureAccount) {
            void inspectAuthenticatedProfile()
            window.dispatchEvent(new Event(AI_ACCOUNTS_REFRESH_EVENT))
          }
          break
      }
    })

    terminal.onData((data) => {
      void (async () => {
        if (cli && composer && isPromptSubmit(data)) {
          const peek = composer.peek().trim()
          const isEnterOnly = data === '\r' || data === '\n' || data === '\r\n'
          if (isEnterOnly && isLikelyPrompt(peek)) {
            const { settings, settingsLoaded } = useDeveloperIntelligenceStore.getState()
            if (settingsLoaded && settings.includeMemoryInPrompts) {
              try {
                const context = await window.api.developerIntelligence.getContext({
                  ...(projectIdAtMount ? { projectId: projectIdAtMount } : {}),
                  query: peek,
                  limit: 5
                })
                const prefix = formatMemoryContextBlock(context)
                if (prefix) {
                  noteSessionContext(
                    sessionId,
                    context.memories.map((memory) => ({
                      category: memory.category,
                      preview: memory.content.slice(0, 160)
                    }))
                  )
                  await window.api.pty.write({ sessionId, data: prefix })
                }
              } catch {
                // Injection is best-effort; never block the prompt.
              }
            }
          }
        }

        await window.api.pty.write({ sessionId, data })
        if (!cli) return
        if (composer) {
          for (const prompt of composer.feed(data)) {
            notePromptInSession(sessionId)
            void recordPromptSent({
              prompt,
              source: 'terminal',
              sessionId,
              provider: agentKind,
              ...(projectIdAtMount ? { projectId: projectIdAtMount } : {}),
              ...(accountId ? { accountId } : {})
            })
          }
        }
        if (isInterrupt(data)) {
          applyCliStatus('waiting')
          return
        }
        if (isPromptSubmit(data)) {
          applyCliStatus('busy')
        }
      })()
    })

    const startSession = async (term: Terminal, nextLaunchMode: PtyLaunchMode = launchMode): Promise<void> => {
      if (kind === 'cursor' && window.api.cli) {
        const detected = await window.api.cli.detect('cursor')
        if (!detected.installed) {
          setInstallPrompt('cursor')
          setStatus(sessionId, 'error', 'Cursor CLI is not installed')
          return
        }
      }

      if (nextLaunchMode === 'login' && kind === 'cursor') {
        term.writeln(
          '\x1b[90mSigning out the current Cursor CLI session so you can add a different account...\x1b[0m'
        )
      }

      let cwd = project?.folderPath ?? ''
      const panelAtLaunch = Object.values(useWorkspaceStore.getState().workspaces)
        .flatMap((workspace) => workspace.panels)
        .find((panel) => panel.id === sessionId)
      const sharedTree = panelAtLaunch?.workspaceIsolation === 'shared'
      const isolate =
        !sharedTree &&
        nextLaunchMode !== 'login' &&
        (AGENT_WORKTREE_KINDS as readonly string[]).includes(kind) &&
        Boolean(cwd) &&
        Boolean(window.api.git?.ensureWorktree)
      if (sharedTree && cwd && panelAtLaunch?.worktreePath && window.api.git?.removeWorktree) {
        await window.api.git.removeWorktree({
          projectRoot: cwd,
          worktreePath: panelAtLaunch.worktreePath
        })
        useWorkspaceStore.getState().setPanelWorktree(sessionId, null)
      }
      if (isolate && cwd) {
        const isolated = await window.api.git.ensureWorktree({
          projectRoot: cwd,
          panelId: sessionId,
          kind: kind as AgentWorktreeKind
        })
        if (isolated.ok && isolated.worktreePath) {
          cwd = isolated.worktreePath
          useWorkspaceStore.getState().setPanelWorktree(sessionId, isolated.worktreePath)
          term.writeln(
            '\x1b[90m[Bikorch] Isolated copy — this agent edits its own folder, not the main project tree.\x1b[0m'
          )
        } else if (!isolated.ok && isolated.error) {
          term.writeln(`\x1b[33m[Bikorch] Could not isolate this agent: ${isolated.error}\x1b[0m`)
          term.writeln('\x1b[33m[Bikorch] Falling back to the main project folder.\x1b[0m')
        }
      }
      const projectIdNow = useWorkspaceStore.getState().activeProjectId
      const folderNow = project?.folderPath
      if (projectIdNow && folderNow) {
        void useIsolationStore.getState().inspect(projectIdNow, folderNow)
      }
      const result: PtyCreateResponse = await window.api.pty.create({
        sessionId,
        cwd,
        kind,
        cols: term.cols,
        rows: term.rows,
        launchMode: nextLaunchMode,
        accountId
      })
      if (nextLaunchMode === 'login') {
        clearPanelLaunchMode(sessionId)
      }
      if (cli) {
        if (result.status === 'error' || (result.reattached && result.status === 'stopped')) {
          endAgentSession(sessionId, null, 'error')
        } else if (!result.reattached) {
          let headSha: string | undefined
          if (cwd && window.api.git?.sessionSnapshot) {
            try {
              const anchor = await window.api.git.sessionSnapshot({ cwd })
              headSha = anchor.headSha ?? undefined
            } catch {
              headSha = undefined
            }
          }
          beginAgentSession(sessionId, {
            kind: agentKind,
            launchMode: nextLaunchMode,
            ...(projectIdAtMount ? { projectId: projectIdAtMount } : {}),
            ...(accountId ? { accountId } : {}),
            ...(cwd && cwd !== (project?.folderPath ?? '') ? { worktreePath: cwd } : {}),
            ...(headSha ? { headSha } : {})
          })
        } else {
          resumeAgentSession(sessionId, {
            kind: agentKind,
            ...(projectIdAtMount ? { projectId: projectIdAtMount } : {}),
            ...(accountId ? { accountId } : {}),
            ...(cwd && cwd !== (project?.folderPath ?? '') ? { worktreePath: cwd } : {})
          })
        }
      }
      setStatus(sessionId, mapProcessStatus(kind, result.status), result.error)
      if (result.status === 'error' && result.error) {
        term.writeln(`\x1b[31m[Error] ${result.error}\x1b[0m`)
        if (result.code === 'CLI_MISSING' && kind === 'cursor') {
          setInstallPrompt('cursor')
        }
      } else if (nextLaunchMode === 'login' && kind === 'cursor') {
        term.writeln(
          '\x1b[33m[Account] Complete sign-in in the browser with the Cursor account you want to add.\x1b[0m'
        )
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
      if (authPollTimer !== null) window.clearInterval(authPollTimer)
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
        const isolatedPath = workspaceAtCleanup?.panels.find((panel) => panel.id === sessionId)?.worktreePath
        const finish = async (): Promise<void> => {
          if (cli) await finalizeAgentSession(sessionId, null, 'closed')
          await window.api.pty.kill({ sessionId })
          if (isolatedPath && folderPathAtMount && window.api.git?.removeWorktree) {
            await window.api.git.removeWorktree({
              projectRoot: folderPathAtMount,
              worktreePath: isolatedPath
            })
            useWorkspaceStore.getState().setPanelWorktree(sessionId, null)
          }
        }
        void finish()
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
      className="terminal-surface relative h-full min-h-0 w-full app-no-drag"
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
              <Button
                type="button"
                disabled={installing}
                onClick={() => setInstallPrompt(null)}
              >
                Hayır
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={installing}
                onClick={() => void handleInstall()}
              >
                {installing ? 'Yükleniyor...' : 'Evet, yükle'}
              </Button>
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
