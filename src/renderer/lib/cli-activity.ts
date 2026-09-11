import type { PtyKind, PtySessionStatus } from '@shared/contracts/pty'

const ANSI_RE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const SPINNER_RE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒]/
const BUSY_WORD_RE = /\b(thinking|generating|searching|analyzing|planning)\b|[✶✻]/i
const IDLE_PROMPT_RE = /(?:^|\n)\s*(?:>|❯|▶|▸|➤|➜)\s*$/
const IDLE_BOX_RE = /(?:ask|message|prompt)\s*(?:the\s+)?(?:agent|model|assistant)?\s*$/i

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

export function inferCliActivity(buffer: string): 'waiting' | 'busy' | null {
  const tail = stripAnsi(buffer).replace(/\r/g, '').slice(-1200)
  if (!tail.trim()) return null
  if (SPINNER_RE.test(tail) || BUSY_WORD_RE.test(tail)) return 'busy'
  if (IDLE_PROMPT_RE.test(tail) || IDLE_BOX_RE.test(tail)) return 'waiting'
  return null
}

export function isPromptSubmit(data: string): boolean {
  return /[\r\n]/.test(data)
}

export function isInterrupt(data: string): boolean {
  return data === '\u0003'
}

const OUTPUT_TAIL_LIMIT = 8000
export const CLI_IDLE_MS = 1800

export class CliActivityTracker {
  private tail = ''
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private receivedSinceBusy = false

  constructor(
    private readonly options: {
      apply: (next: 'waiting' | 'busy') => void
      getStatus: () => PtySessionStatus | undefined
      idleMs?: number
    }
  ) {}

  feed(chunk: string): void {
    this.tail = (this.tail + chunk).slice(-OUTPUT_TAIL_LIMIT)
    const inferred = inferCliActivity(this.tail)
    const current = this.options.getStatus()
    if (current === 'busy') this.receivedSinceBusy = true

    if (inferred === 'busy') {
      this.apply('busy')
      this.clearIdle()
      return
    }
    if (inferred === 'waiting') {
      this.apply('waiting')
      return
    }

    if (current !== 'busy' || !this.receivedSinceBusy) return
    this.clearIdle()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (inferCliActivity(this.tail) !== 'busy') this.apply('waiting')
    }, this.options.idleMs ?? CLI_IDLE_MS)
  }

  dispose(): void {
    this.clearIdle()
  }

  private apply(next: 'waiting' | 'busy'): void {
    const current = this.options.getStatus()
    if (current === 'stopped' || current === 'error') return
    if (next === 'busy') this.receivedSinceBusy = current === 'busy' ? this.receivedSinceBusy : false
    if (current === next) return
    this.options.apply(next)
  }

  private clearIdle(): void {
    if (this.idleTimer === null) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}
