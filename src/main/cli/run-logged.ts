import { spawn, type SpawnOptions } from 'child_process'

export interface RunLoggedOptions extends Pick<SpawnOptions, 'cwd' | 'env' | 'windowsHide'> {
  timeoutMs: number
  signal?: AbortSignal
  onLine?: (line: string) => void
}

export class InstallCancelledError extends Error {
  constructor() {
    super('Installation cancelled')
    this.name = 'InstallCancelledError'
  }
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g
const MAX_LINE = 500
const TAIL_LINES = 8

export function cleanInstallerLine(raw: string): string {
  // Progress bars redraw with \r; keep only the last frame of the line.
  const frame = raw.split('\r').filter((part) => part.trim()).pop() ?? ''
  return frame.replace(ANSI, '').trimEnd().slice(0, MAX_LINE)
}

/**
 * Runs an installer step, streaming its output line by line so the UI can show
 * progress, and stopping it when the signal aborts or the timeout passes.
 * Failures carry the last few output lines instead of the whole transcript.
 */
export function runLogged(command: string, args: string[], options: RunLoggedOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new InstallCancelledError())
      return
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: options.windowsHide ?? true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const tail: string[] = []
    let settled = false
    let cancelled = false
    let timedOut = false

    const emit = (line: string): void => {
      const clean = cleanInstallerLine(line)
      if (!clean.trim()) return
      tail.push(clean)
      if (tail.length > TAIL_LINES) tail.shift()
      options.onLine?.(clean)
    }
    const attach = (stream: NodeJS.ReadableStream | null): void => {
      let buffer = ''
      stream?.setEncoding('utf8')
      stream?.on('data', (chunk: string) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) emit(line)
      })
      stream?.on('end', () => {
        if (buffer) emit(buffer)
        buffer = ''
      })
    }
    attach(child.stdout)
    attach(child.stderr)

    const stop = (): void => {
      if (child.exitCode === null) child.kill()
    }
    const onAbort = (): void => {
      cancelled = true
      stop()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, options.timeoutMs)

    const finish = (error: Error | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }

    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (cancelled) return finish(new InstallCancelledError())
      if (timedOut) return finish(new Error('The installer took too long and was stopped'))
      if (code === 0) return finish(null)
      const detail = tail.slice(-3).join(' · ')
      finish(new Error(detail || `Installer exited with code ${code}`))
    })
  })
}
