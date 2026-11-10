import type { PtyKind, PtySessionStatus } from '@shared/contracts/pty'
import { looksWorkspaceTrustPrompt } from '@shared/cli-permission'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import {
  cliMovedOnFromText,
  inferCliActivityFromText,
  inferCliAskingFromText,
  screenShowsWorking
} from '@shared/cli-activity-detect'

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

const OSC_RE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const CURSOR_FORWARD_RE = /\u001b\[(\d*)C/g
const CURSOR_PLACE_RE = /\u001b\[\d*(?:;\d*)?[Hf]|\u001b\[\d*[AB]/g
const CURSOR_COLUMN_RE = /\u001b\[\d*G/g

/**
 * Terminal output as readable text. TUIs such as Claude Code move the cursor
 * instead of printing spaces and line breaks, and set the window title with
 * spinner glyphs; plain stripping would glue words together and keep those.
 */
export function streamText(value: string): string {
  return value
    .replace(OSC_RE, '')
    .replace(CURSOR_FORWARD_RE, (_match, count: string) => ' '.repeat(Math.min(Number(count) || 1, 200)))
    .replace(CURSOR_COLUMN_RE, ' ')
    .replace(CURSOR_PLACE_RE, '\n')
    .replace(ANSI_RE, '')
    .replace(/\u00a0/g, ' ')
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
  return inferCliActivityFromText(streamText(buffer.slice(-4000)), options)
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
/** How often a screen-backed tracker re-reads its screen while output flows. */
export const SCREEN_CLASSIFY_MS = 100

/** The visible rows of a headless terminal, trailing blank rows removed. */
export function screenText(screen: HeadlessTerminal): string {
  const buffer = screen.buffer.active
  const lines: string[] = []
  for (let row = 0; row < screen.rows; row += 1) {
    lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '')
  }
  return lines.join('\n').replace(/\n+$/, '')
}

/**
 * Busy/idle for one CLI session. The output stream decides by default. With
 * `screen`, the output is also played into a headless terminal: TUIs redraw in
 * place, and a spinner line still on screen means the CLI is working even
 * when the newest bytes in the stream are input hints or a tool's output.
 * The screen is wider than any real panel so layout never wraps differently.
 */
export class CliActivityTracker {
  private tail = ''
  private asking = false
  private lastChunk = ''
  private readonly screen: HeadlessTerminal | null
  private classifyTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(
    private readonly options: {
      apply: (next: 'waiting' | 'busy') => void
      getStatus: () => PtySessionStatus | undefined
      screen?: boolean
    }
  ) {
    this.screen = options.screen
      ? new HeadlessTerminal({ cols: 240, rows: 60, scrollback: 0, allowProposedApi: true })
      : null
  }

  /** Whether `classify` runs by itself once the screen has caught up. */
  get readsScreen(): boolean {
    return this.screen !== null
  }

  feed(chunk: string): void {
    this.feedText(chunk)
    if (!this.screen) this.classify()
  }

  feedText(chunk: string): void {
    this.tail = (this.tail + chunk).slice(-OUTPUT_TAIL_LIMIT)
    this.lastChunk = chunk
    if (this.screen) this.screen.write(chunk, () => this.scheduleClassify())
  }

  classify(): void {
    if (this.screen && screenShowsWorking(screenText(this.screen))) {
      this.apply('busy')
      return
    }
    const inferred = inferCliActivity(this.tail)
    if (inferred === 'busy') {
      this.apply('busy')
      return
    }
    if (inferred === 'waiting') {
      this.apply('waiting')
    }
  }

  /**
   * True from the moment the output shows an approval or question prompt until
   * the CLI moves on (works again or returns to its input). A prompt left on
   * screen keeps redrawing other glyphs, so the question can scroll out of the
   * recent text while it is still being asked.
   */
  isAsking(): boolean {
    if (inferCliAskingFromText(streamText(this.tail.slice(-4000)))) {
      this.asking = true
    } else if (this.asking && cliMovedOnFromText(streamText(this.lastChunk))) {
      this.asking = false
    }
    return this.asking
  }

  dispose(): void {
    this.disposed = true
    if (this.classifyTimer !== null) clearTimeout(this.classifyTimer)
    this.classifyTimer = null
    this.screen?.dispose()
  }

  private scheduleClassify(): void {
    if (this.disposed || this.classifyTimer !== null) return
    this.classifyTimer = setTimeout(() => {
      this.classifyTimer = null
      if (!this.disposed) this.classify()
    }, SCREEN_CLASSIFY_MS)
  }

  private apply(next: 'waiting' | 'busy'): void {
    const current = this.options.getStatus()
    if (current === 'stopped' || current === 'error') return
    if (current === next) return
    this.options.apply(next)
  }
}
