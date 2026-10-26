import type { PtyKind, PtySessionStatus } from '@shared/contracts/pty'
import { looksWorkspaceTrustPrompt } from '@shared/cli-permission'
import { inferCliActivityFromText } from '@shared/cli-activity-detect'

const ANSI_RE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
export function isCliKind(kind: PtyKind): boolean {
  return (
    kind === 'cursor' ||
    kind === 'claude' ||
    kind === 'gemini' ||
    kind === 'antigravity' ||
    kind === 'codex'
  )
}

export function mapProcessStatus(
  kind: PtyKind,
  status: PtySessionStatus
): PtySessionStatus {
  if (isCliKind(kind) && status === 'running') return 'waiting'
  return status
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}

export function looksCliSignedIn(kind: PtyKind, buffer: string): boolean {
  const tail = stripAnsi(buffer).replace(/\r/g, '')
  if (kind === 'cursor') {
    return (
      /Plan,\s*search,\s*build anything/i.test(tail) ||
      /logged in as\b|successfully logged in|authentication successful|login successful/i.test(tail)
    )
  }
  if (/not logged in|not signed in|please (?:sign|log) in|authentication required/i.test(tail)) {
    return false
  }
  return false
}

export function inferCliActivity(buffer: string, options: { screen?: boolean } = {}): 'waiting' | 'busy' | null {
  // Strip only the recent end: the full buffer can be several KB of escape codes.
  return inferCliActivityFromText(stripAnsi(buffer.slice(-4000)), options)
}

export { looksWorkspaceTrustPrompt }

export const TRUST_ACCEPT_SEQUENCE = 'a\r'

export function isPromptSubmit(data: string): boolean {
  return /[\r\n]/.test(data)
}

export function isInterrupt(data: string): boolean {
  return data === '\u0003'
}

const OUTPUT_TAIL_LIMIT = 8000

export class CliActivityTracker {
  private tail = ''

  constructor(
    private readonly options: {
      apply: (next: 'waiting' | 'busy') => void
      getStatus: () => PtySessionStatus | undefined
    }
  ) {}

  feed(chunk: string): void {
    this.tail = (this.tail + chunk).slice(-OUTPUT_TAIL_LIMIT)
    const inferred = inferCliActivity(this.tail)
    if (inferred === 'busy') {
      this.apply('busy')
      return
    }
    if (inferred === 'waiting') {
      this.apply('waiting')
    }
  }

  dispose(): void {}

  private apply(next: 'waiting' | 'busy'): void {
    const current = this.options.getStatus()
    if (current === 'stopped' || current === 'error') return
    if (current === next) return
    this.options.apply(next)
  }
}
