import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import type { PtyEvent } from '@shared/contracts/pty'
import { getTerminalOptions } from '@renderer/lib/terminal-theme'
import {
  SETUP_PROJECT_ID,
  inspectSignIn,
  useSetupSignInStore,
  type SetupSignIn
} from '@renderer/lib/standalone-sign-in'
import { Button } from '@renderer/components/ui/Button'

const POLL_MS = 2000
// After this long the dialog stops pretending all is well and offers help,
// but keeps checking: a slow browser sign-in should still complete.
const SLOW_LOGIN_MS = 3 * 60_000
const URL_PATTERN = /https:\/\/[^\s"'<>\u001b]+/g

function SignInTerminal({ signIn }: { signIn: SetupSignIn }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const finish = useSetupSignInStore((state) => state.finish)
  const [status, setStatus] = useState<'starting' | 'waiting' | 'slow' | 'error'>('starting')
  const [error, setError] = useState<string | null>(null)
  const [lastUrl, setLastUrl] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let active = true
    const terminal = new Terminal({ ...getTerminalOptions(signIn.kind), scrollback: 1000 })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    fit.fit()

    let output = ''
    const stopEvents = window.api.pty.onEvent((event: PtyEvent) => {
      if (event.sessionId !== signIn.sessionId) return
      if (event.type === 'data') {
        terminal.write(event.data)
        output = (output + event.data).slice(-8000)
        const urls = output.match(URL_PATTERN)
        if (urls?.length) setLastUrl(urls[urls.length - 1])
      } else if (event.type === 'exit') {
        terminal.writeln('\r\n\x1b[90m[The CLI exited. Close this window and try again if sign-in did not finish.]\x1b[0m')
      } else if (event.type === 'status' && event.status === 'error' && event.error) {
        setStatus('error')
        setError(event.error)
      }
    })
    const input = terminal.onData((data) => {
      void window.api.pty.write({ sessionId: signIn.sessionId, data })
    })
    let ready = false
    const resize = new ResizeObserver(() => {
      fit.fit()
      // The session only exists once create resolves; resizing earlier is rejected.
      if (ready) {
        void window.api.pty
          .resize({ sessionId: signIn.sessionId, cols: terminal.cols, rows: terminal.rows })
          .catch(() => undefined)
      }
    })
    resize.observe(container)

    void window.api.pty
      .create({
        sessionId: signIn.sessionId,
        projectId: SETUP_PROJECT_ID,
        cwd: '',
        kind: signIn.kind,
        cols: terminal.cols,
        rows: terminal.rows,
        launchMode: 'login',
        accountId: signIn.accountId
      })
      .then((result) => {
        if (!active) return
        if (result.status === 'error') {
          setStatus('error')
          setError(result.error ?? 'The CLI could not start')
          return
        }
        ready = true
        setStatus('waiting')
        terminal.focus()
      })
      .catch((failure: unknown) => {
        if (!active) return
        setStatus('error')
        setError(failure instanceof Error ? failure.message : 'The CLI could not start')
      })

    const startedAt = Date.now()
    let inFlight = false
    const poll = window.setInterval(() => {
      if (!active || inFlight) return
      if (Date.now() - startedAt > SLOW_LOGIN_MS) setStatus((current) => (current === 'waiting' ? 'slow' : current))
      inFlight = true
      void inspectSignIn(signIn.kind, signIn.accountId)
        .then((result) => {
          if (active && result.ok && result.ready) finish(result.identity)
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false
        })
    }, POLL_MS)

    return () => {
      active = false
      window.clearInterval(poll)
      resize.disconnect()
      input.dispose()
      stopEvents()
      terminal.dispose()
    }
  }, [signIn, finish])

  const label = AI_ACCOUNT_LABELS[signIn.kind]
  return (
    <>
      <p className="setup-signin-hint">
        {status === 'error'
          ? error
          : status === 'slow'
            ? `Still waiting for ${label}. If the browser did not open, use the link below. You can also close this window and try again.`
            : `Follow the steps below. ${label} may open your browser; come back here when it says you are signed in.`}
      </p>
      <div ref={containerRef} className="setup-signin-terminal" data-terminal-session={signIn.sessionId} />
      {lastUrl && (
        <div className="setup-signin-link">
          <span className="truncate">{lastUrl}</span>
          <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(lastUrl)}>
            Copy link
          </Button>
        </div>
      )}
    </>
  )
}

export default function SetupSignInDialog(): React.JSX.Element | null {
  const active = useSetupSignInStore((state) => state.active)
  const cancel = useSetupSignInStore((state) => state.cancel)
  if (!active) return null
  return (
    <div className="setup-signin-overlay" role="presentation">
      <div className="setup-signin-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-signin-title">
        <div className="setup-signin-head">
          <p id="setup-signin-title" className="setup-signin-title">
            Sign in to {AI_ACCOUNT_LABELS[active.kind]}
          </p>
          <Button size="sm" variant="secondary" onClick={cancel}>
            Cancel
          </Button>
        </div>
        <SignInTerminal key={active.sessionId} signIn={active} />
      </div>
    </div>
  )
}
