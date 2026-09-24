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
import { registerLiveTerminal, unregisterLiveTerminal } from '@renderer/lib/live-terminals'
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
import { formatMemoryContextInline } from '@renderer/lib/developer-context'
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
import {
  TERMINAL_FIT_SETTLE_MS,
  measureTerminalGrid,
  pinViewportToBottom,
  shouldPinTerminalToBottom,
  terminalGridEquals,
  viewportIsAtBottom
} from '@renderer/lib/terminal-fit'
import { TerminalInputQueue } from '@renderer/lib/terminal-input-queue'
import { cn } from '@renderer/lib/utils'

interface TerminalViewProps {
  sessionId: string
  kind: PtyKind
  launchMode?: PtyLaunchMode
  accountId?: string
  cliModel?: string
}

const PTY_RESIZE_MS = 80

export function TerminalView({
  sessionId,
  kind,
  launchMode = 'normal',
  accountId,
  cliModel
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
  const layoutLockDepthRef = useRef(0)
  const layoutLockGenRef = useRef(0)
  const lastPtySizeRef = useRef({ cols: 0, rows: 0 })
  const ptyReadyRef = useRef(false)
  const ptyResizeTimerRef = useRef<number | null>(null)
  const settleTimersRef = useRef<number[]>([])
  const cliKind = isCliKind(kind)
  const [compactHost, setCompactHost] = useState(false)

  const pinIfNeeded = useCallback((force = false) => {
    const terminal = terminalRef.current
    const container = containerRef.current
    if (!terminal || !container) return
    const viewport = container.querySelector('.xterm-viewport') as HTMLElement | null
    const atBottom = viewport ? viewportIsAtBottom(viewport) : true
    if (!force && !shouldPinTerminalToBottom(terminal.buffer.active.type === 'alternate', atBottom)) return
    terminal.scrollToBottom()
    if (viewport) pinViewportToBottom(viewport)
  }, [])

  const sendPtyResize = useCallback((cols: number, rows: number, immediate: boolean) => {
    const next = { cols, rows }
    if (terminalGridEquals(lastPtySizeRef.current, next)) return
    if (ptyResizeTimerRef.current !== null) {
      window.clearTimeout(ptyResizeTimerRef.current)
      ptyResizeTimerRef.current = null
    }
    const flush = (): void => {
      lastPtySizeRef.current = next
      void window.api.pty
        .resize({ sessionId, cols, rows })
        .catch(() => {
          // Retry on the next grid change if the PTY was temporarily unavailable.
          if (terminalGridEquals(lastPtySizeRef.current, next)) {
            lastPtySizeRef.current = { cols: 0, rows: 0 }
          }
        })
        .finally(() => {
          window.setTimeout(() => {
            if (disposedRef.current || layoutLockedRef.current) return
            pinIfNeeded()
          }, 40)
        })
    }
    if (immediate) {
      flush()
      return
    }
    ptyResizeTimerRef.current = window.setTimeout(() => {
      ptyResizeTimerRef.current = null
      if (disposedRef.current) return
      flush()
    }, PTY_RESIZE_MS)
  }, [pinIfNeeded, sessionId])

  const fitTerminal = useCallback((sendPty = true, immediate = false): boolean => {
    if (disposedRef.current) return false

    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    const container = containerRef.current
    if (!terminal || !fitAddon || !container) return false
    if (layoutLockedRef.current || !container.isConnected) return false

    try {
      const viewport = container.querySelector('.xterm-viewport') as HTMLElement | null
      const wasAtBottom = viewport ? viewportIsAtBottom(viewport) : true

      // FitAddon already calculates the exact usable host area (including
      // scrollbars). Calling fit() and then doing a second manual calculation
      // can resize xterm twice to slightly different grids, which makes TUIs
      // redraw and jump after a panel resize.
      const proposed = fitAddon.proposeDimensions()
      const next = measureTerminalGrid(container, null, proposed)
      if (!next) return false
      if (terminal.cols !== next.cols || terminal.rows !== next.rows) {
        terminal.resize(next.cols, next.rows)
      }

      try {
        terminal.refresh(0, Math.max(0, terminal.rows - 1))
      } catch {
        // Renderer may not be ready on the first paint.
      }

      if (shouldPinTerminalToBottom(terminal.buffer.active.type === 'alternate', wasAtBottom)) {
        pinIfNeeded(true)
      }

      if (sendPty && ptyReadyRef.current) sendPtyResize(next.cols, next.rows, immediate)
      return true
    } catch {
      // xterm can throw if the renderer is not ready yet
      return false
    }
  }, [pinIfNeeded, sendPtyResize])

  const scheduleFit = useCallback(() => {
    if (disposedRef.current || layoutLockedRef.current) return
    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current)
    }
    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null
      fitTerminal()
    })
  }, [fitTerminal])

  const settleFit = useCallback(() => {
    if (disposedRef.current) return
    const generation = layoutLockGenRef.current
    for (const timer of settleTimersRef.current) window.clearTimeout(timer)
    settleTimersRef.current = []

    const run = (immediate: boolean): void => {
      if (disposedRef.current || layoutLockedRef.current) return
      if (generation !== layoutLockGenRef.current) return
      fitTerminal(true, immediate)
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => run(true))
    })
    for (const delay of TERMINAL_FIT_SETTLE_MS) {
      if (delay === 0) continue
      settleTimersRef.current.push(window.setTimeout(() => run(true), delay))
    }
  }, [fitTerminal])

  useEffect(() => {
    const container = containerRef.current
    if (!container || initializedRef.current) return
    initializedRef.current = true
    disposedRef.current = false
    ptyReadyRef.current = false
    lastPtySizeRef.current = { cols: 0, rows: 0 }
    layoutLockDepthRef.current = 0
    layoutLockedRef.current = false
    const projectIdAtMount = activeProjectId
    const folderPathAtMount = project?.folderPath ?? null
    // React StrictMode may replay this effect in development. Do not let the
    // first async worktree/PTTY bootstrap continue after its cleanup, or two
    // attempts can race on the same deterministic branch.
    let active = true

    const terminal = new Terminal(getTerminalOptions(kind))
    registerLiveTerminal(sessionId, kind, terminal)

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
    let lastInputError: string | null = null
    let authInspectTimer: number | null = null
    let authPollTimer: number | null = null
    let authCaptured = false
    let authCaptureInFlight = false
    let lastAuthCaptureError: string | null = null
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
      if (current === next) return
      setStatus(sessionId, next)
    }

    const noteOutput = (chunk: string): void => {
      if (!cli) return
      outputTail = (outputTail + chunk).slice(-8000)
      useTerminalStore.getState().setOutputTail(sessionId, outputTail)
      const inferred = inferCliActivity(outputTail)
      if (inferred === 'busy') {
        applyCliStatus('busy')
        return
      }
      if (inferred === 'waiting') {
        applyCliStatus('waiting')
      }
    }

    let inputQueue: TerminalInputQueue | null = null
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
          ptyReadyRef.current = false
          inputQueue?.close()
          if (cli) endAgentSession(sessionId, event.exitCode, 'exited')
          if (cli && folderPathAtMount && window.api.git?.noteAgentSession) {
            void window.api.git.noteAgentSession({
              projectRoot: folderPathAtMount,
              runId: sessionId,
              sessionId,
              reason: 'exited'
            })
          }
          setStatus(sessionId, 'stopped')
          terminal.writeln(`\r\n\x1b[90m[Process exited with code ${event.exitCode}]\x1b[0m`)
          if (shouldCaptureAccount) {
            void inspectAuthenticatedProfile()
            window.dispatchEvent(new Event(AI_ACCOUNTS_REFRESH_EVENT))
          }
          break
      }
    })

    inputQueue = new TerminalInputQueue(
      async (data) => {
        if (!active || !ptyReadyRef.current) return
        if (cli && composer && isPromptSubmit(data)) {
          const peek = composer.peek().trim()
          const isEnterOnly = data === '\r' || data === '\n' || data === '\r\n'
          if (isEnterOnly && isLikelyPrompt(peek)) {
            const { settings, settingsLoaded } = useDeveloperIntelligenceStore.getState()
            if (settingsLoaded && settings.includeMemoryInPrompts) {
              try {
                let timer: number | null = null
                const context = await Promise.race([
                  window.api.developerIntelligence.getContext({
                    ...(projectIdAtMount ? { projectId: projectIdAtMount } : {}),
                    query: peek,
                    limit: 5
                  }),
                  new Promise<null>((resolve) => {
                    timer = window.setTimeout(() => resolve(null), 250)
                  })
                ]).finally(() => {
                  if (timer !== null) window.clearTimeout(timer)
                })
                const inline = context ? formatMemoryContextInline(context) : ''
                if (inline && active && ptyReadyRef.current && context) {
                  noteSessionContext(
                    sessionId,
                    context.memories.map((memory) => ({
                      category: memory.category,
                      preview: memory.content.slice(0, 160)
                    }))
                  )
                  await window.api.pty.write({ sessionId, data: inline })
                }
              } catch {
                // Injection is best-effort; never block the prompt.
              }
            }
          }
        }

        if (!active || !ptyReadyRef.current) return
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
      },
      (error) => {
        if (!active) return
        const message = error instanceof Error ? error.message : 'Terminal input could not be sent'
        if (message !== lastInputError) {
          lastInputError = message
          terminal.writeln(`\r\n\x1b[31m[Input] ${message}\x1b[0m`)
        }
        if (/no longer (?:running|available)|disconnected/i.test(message)) {
          ptyReadyRef.current = false
          inputQueue?.close()
          setStatus(sessionId, 'error', message)
        }
      }
    )

    terminal.onData((data) => {
      if (!inputQueue?.offer(data) && active && useTerminalStore.getState().getStatus(sessionId) === 'starting') {
        terminal.writeln('\r\n\x1b[33m[Input] Terminal is still starting; wait before pasting more text.\x1b[0m')
      }
    })

    const startSession = async (term: Terminal, nextLaunchMode: PtyLaunchMode = launchMode): Promise<void> => {
      if (!active) return
      if (nextLaunchMode === 'login' && kind === 'cursor') {
        term.writeln(
          '\x1b[90mSigning out the current Cursor CLI session so you can add a different account...\x1b[0m'
        )
      }

      let cwd = project?.folderPath ?? ''
      let worktreePath: string | undefined
      const panelAtLaunch = Object.values(useWorkspaceStore.getState().workspaces)
        .flatMap((workspace) => workspace.panels)
        .find((panel) => panel.id === sessionId)
      const secretaryPanel = panelAtLaunch?.panelRole === 'secretary'
      const stopUnisolatedSecretary = (reason: string): void => {
        const message = `Secretary needs a separate Git worktree: ${reason}`
        term.writeln(`\x1b[31m[Bikorch] ${message}\x1b[0m`)
        setStatus(sessionId, 'error', message)
      }
      const resolverCwd = panelAtLaunch?.panelRole === 'resolver' ? panelAtLaunch.cwdOverride : panelAtLaunch?.cwdOverride
      if (resolverCwd) {
        cwd = resolverCwd
        worktreePath = resolverCwd
      }
      if (secretaryPanel && (
        panelAtLaunch?.workspaceIsolation !== 'isolated' ||
        resolverCwd ||
        nextLaunchMode === 'login' ||
        !cwd ||
        !(AGENT_WORKTREE_KINDS as readonly string[]).includes(kind) ||
        !window.api.git?.ensureWorktree
      )) {
        stopUnisolatedSecretary('open this task from a Git project with worktree support; sign in from Accounts first.')
        return
      }
      const sharedTree = panelAtLaunch?.workspaceIsolation === 'shared' && panelAtLaunch?.panelRole !== 'resolver'
      const isolate =
        !resolverCwd &&
        !sharedTree &&
        nextLaunchMode !== 'login' &&
        (AGENT_WORKTREE_KINDS as readonly string[]).includes(kind) &&
        Boolean(cwd) &&
        Boolean(window.api.git?.ensureWorktree)
      if (sharedTree && cwd && panelAtLaunch?.worktreePath && window.api.git?.removeWorktree) {
        await window.api.git.removeWorktree({
          projectRoot: cwd,
          worktreePath: panelAtLaunch.worktreePath,
          title: panelAtLaunch.title,
          mode: 'park'
        })
        if (!active) return
        useWorkspaceStore.getState().setPanelWorktree(sessionId, null)
        worktreePath = undefined
      }
      if (isolate && cwd) {
        const isolated = await window.api.git.ensureWorktree({
          projectRoot: cwd,
          panelId: sessionId,
          kind: kind as AgentWorktreeKind,
          title: panelAtLaunch?.title
        }).catch((cause: unknown) => ({
          ok: false as const,
          error: cause instanceof Error ? cause.message : 'worktree creation failed'
        }))
        if (!active) return
        if (isolated.ok && isolated.worktreePath) {
          cwd = isolated.worktreePath
          worktreePath = isolated.worktreePath
          useWorkspaceStore.getState().setPanelWorktree(sessionId, isolated.worktreePath)
          term.writeln(
            '\x1b[90m[Bikorch] Separate workspace — this agent edits its own copy until you apply it to the project.\x1b[0m'
          )
          if (isolated.resumeContext) {
            for (const line of isolated.resumeContext.split('\n')) {
              term.writeln(`\x1b[90m${line}\x1b[0m`)
            }
          }
        } else {
          const reason = isolated.ok ? 'this project is not a Git repository.' : isolated.error || 'worktree creation failed.'
          if (secretaryPanel) {
            stopUnisolatedSecretary(reason)
            return
          }
          term.writeln(`\x1b[33m[Bikorch] Could not open a separate workspace: ${reason}\x1b[0m`)
          term.writeln('\x1b[33m[Bikorch] Falling back to the project folder.\x1b[0m')
        }
      }
      const projectIdNow = useWorkspaceStore.getState().activeProjectId
      const folderNow = project?.folderPath
      if (projectIdNow && folderNow) {
        void useIsolationStore.getState().inspect(projectIdNow, folderNow)
      }
      if (!projectIdAtMount) {
        setStatus(sessionId, 'error', 'Open this terminal from a project workspace first.')
        return
      }
      if (!active) return
      const launchGrid = { cols: term.cols, rows: term.rows }
      let result: PtyCreateResponse
      try {
        result = await window.api.pty.create({
          sessionId,
          projectId: projectIdAtMount,
          cwd,
          ...(worktreePath ? { worktreePath } : {}),
          kind,
          ...launchGrid,
          launchMode: nextLaunchMode,
          accountId,
          ...(cliModel ? { cliModel } : {})
        })
      } catch (error) {
        if (!active) return
        const message = error instanceof Error ? error.message : 'Terminal could not start'
        setStatus(sessionId, 'error', message)
        term.writeln(`\r\n\x1b[31m[Error] ${message}\x1b[0m`)
        return
      }
      if (!active) return
      // The create request can take seconds while a worktree/account is prepared.
      // Remember the grid actually sent, then catch up if the pane resized meanwhile.
      lastPtySizeRef.current = launchGrid
      if (result.status !== 'error' && result.status !== 'stopped') {
        ptyReadyRef.current = true
        inputQueue?.ready()
        sendPtyResize(term.cols, term.rows, true)
      }
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
    let launchRequested = false
    const maybeStart = (): void => {
      if (!active || launchRequested || !fitTerminal(false)) return
      launchRequested = true
      void startSession(terminal)
      if (document.visibilityState === 'visible' && document.activeElement === document.body) {
        terminal.focus()
      }
    }

    const focusThis = (): void => {
      scheduleFit()
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
        layoutLockDepthRef.current += 1
        layoutLockGenRef.current += 1
        layoutLockedRef.current = true
        for (const timer of settleTimersRef.current) window.clearTimeout(timer)
        settleTimersRef.current = []
        return
      }
      layoutLockDepthRef.current = Math.max(0, layoutLockDepthRef.current - 1)
      if (layoutLockDepthRef.current > 0) return
      layoutLockedRef.current = false
      settleFit()
      requestAnimationFrame(maybeStart)
    }

    container.addEventListener('pointerdown', focusThis)
    window.addEventListener(FOCUS_TERMINAL_EVENT, onFocusRequest)
    window.addEventListener(TERMINAL_LAYOUT_LOCK_EVENT, onLayoutLock)

    const onHostResize = (): void => {
      setCompactHost(container.clientWidth < 240 || container.clientHeight < 115)
      scheduleFit()
      if (!launchRequested) requestAnimationFrame(maybeStart)
    }
    const resizeObserver = new ResizeObserver(onHostResize)
    resizeObserver.observe(container)
    window.addEventListener('resize', onHostResize)

    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') return
      settleFit()
      requestAnimationFrame(maybeStart)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const onFontsReady = (): void => {
      if (!disposedRef.current) {
        settleFit()
        requestAnimationFrame(maybeStart)
      }
    }
    void document.fonts?.ready.then(onFontsReady)

    requestAnimationFrame(() => {
      requestAnimationFrame(maybeStart)
    })

    return () => {
      active = false
      disposedRef.current = true
      ptyReadyRef.current = false
      inputQueue?.close()
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current)
        fitFrameRef.current = null
      }
      if (ptyResizeTimerRef.current !== null) {
        window.clearTimeout(ptyResizeTimerRef.current)
        ptyResizeTimerRef.current = null
      }
      for (const timer of settleTimersRef.current) window.clearTimeout(timer)
      settleTimersRef.current = []
      if (authInspectTimer !== null) window.clearTimeout(authInspectTimer)
      if (authPollTimer !== null) window.clearInterval(authPollTimer)
      resizeObserver.disconnect()
      window.removeEventListener('resize', onHostResize)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      container.removeEventListener('pointerdown', focusThis)
      window.removeEventListener(FOCUS_TERMINAL_EVENT, onFocusRequest)
      window.removeEventListener(TERMINAL_LAYOUT_LOCK_EVENT, onLayoutLock)
      unsubscribe()
      unregisterLiveTerminal(sessionId)
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
        const finish = async (): Promise<void> => {
          if (cli) await finalizeAgentSession(sessionId, null, 'closed')
          await window.api.pty.kill({ sessionId })
        }
        void finish()
      }
      if (!panelStillExists) removeSession(sessionId)
    }
  }, [sessionId, kind, accountId, cliModel, project?.folderPath, setStatus, removeSession, clearPanelLaunchMode, scheduleFit, settleFit, fitTerminal, sendPtyResize])

  // Refit when project tab becomes active again
  useEffect(() => {
    if (!activeProjectId) return
    settleFit()
  }, [activeProjectId, settleFit])

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
      className={cn(
        'terminal-surface relative h-full min-h-0 w-full app-no-drag',
        cliKind && 'is-cli-tui'
      )}
      data-terminal-session={sessionId}
      onPointerDown={() => terminalRef.current?.focus()}
    >
      <div ref={containerRef} className="terminal-host" />
      {compactHost && (
        <div className="terminal-compact-hint" aria-live="polite">Dar alan · büyüt veya kaydır</div>
      )}
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
