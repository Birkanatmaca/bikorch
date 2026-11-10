export const TERMINAL_GRID = {
  minCols: 20,
  minRows: 6,
  maxCols: 400,
  maxRows: 200,
  // Smaller hosts still render a minimum PTY grid; the host can scroll it.
  minHostWidth: 24,
  minHostHeight: 16
} as const

/** Extra fits after a layout change so CSS transitions and TUI redraws can settle. */
export const TERMINAL_FIT_SETTLE_MS = [0, 48, 140, 280] as const

export interface TerminalGridSize {
  cols: number
  rows: number
}

export interface TerminalBox {
  clientWidth: number
  clientHeight: number
}

export interface TerminalCellSize {
  width: number
  height: number
}

export interface TerminalViewportBox {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export function clampTerminalGrid(cols: number, rows: number): TerminalGridSize {
  return {
    cols: Math.max(TERMINAL_GRID.minCols, Math.min(TERMINAL_GRID.maxCols, Math.floor(cols))),
    rows: Math.max(TERMINAL_GRID.minRows, Math.min(TERMINAL_GRID.maxRows, Math.floor(rows)))
  }
}

export function measureTerminalGrid(
  host: TerminalBox,
  cell?: TerminalCellSize | null,
  proposed?: TerminalGridSize | null
): TerminalGridSize | null {
  if (host.clientWidth < TERMINAL_GRID.minHostWidth || host.clientHeight < TERMINAL_GRID.minHostHeight) {
    return null
  }
  if (cell && cell.width > 0 && cell.height > 0) {
    return clampTerminalGrid(host.clientWidth / cell.width, host.clientHeight / cell.height)
  }
  if (proposed && proposed.cols > 0 && proposed.rows > 0) {
    return clampTerminalGrid(proposed.cols, proposed.rows)
  }
  return null
}

export function terminalGridEquals(a: TerminalGridSize, b: TerminalGridSize): boolean {
  return a.cols === b.cols && a.rows === b.rows
}

export function viewportIsAtBottom(viewport: TerminalViewportBox, slopPx = 36): boolean {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= slopPx
}

export function shouldPinTerminalToBottom(alternateBuffer: boolean, wasAtBottom: boolean): boolean {
  // Full-screen TUIs use the alternate buffer. Normal-buffer CLI history should
  // retain the user's scroll position just like a shell terminal.
  return alternateBuffer || wasAtBottom
}

export function pinViewportToBottom(viewport: HTMLElement): void {
  viewport.scrollTop = Math.max(0, viewport.scrollHeight)
}

export function readXtermCellSize(terminal: {
  cols: number
  rows: number
  element?: HTMLElement | null
}): TerminalCellSize | null {
  const core = (
    terminal as {
      _core?: { _renderService?: { dimensions?: { css?: { cell?: TerminalCellSize } } } }
    }
  )._core
  const cell = core?._renderService?.dimensions?.css?.cell
  if (cell && cell.width > 0 && cell.height > 0) return { width: cell.width, height: cell.height }

  const screen = terminal.element?.querySelector('.xterm-screen') as HTMLElement | null
  if (!screen || terminal.cols <= 0 || terminal.rows <= 0) return null
  const width = screen.clientWidth / terminal.cols
  const height = screen.clientHeight / terminal.rows
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

/** How long after a wheel/touch/scroll-key gesture a viewport scroll still counts as the user's. */
export const TERMINAL_SCROLL_INTENT_MS = 400

/**
 * Tells user-driven scrolls apart from scroll events xterm's DOM viewport emits
 * on its own. xterm 5 turns every viewport `scroll` event into a buffer scroll;
 * when a TUI clears scrollback (ED3) and redraws quickly, a late event carrying
 * a stale `scrollTop` moves the view up and marks it "user scrolled", so new
 * output stops following and the prompt stays off-screen until a resize.
 */
export class TerminalScrollIntent {
  private intentUntil = 0
  private pointerHeld = false

  note(now: number, windowMs: number = TERMINAL_SCROLL_INTENT_MS): void {
    this.intentUntil = Math.max(this.intentUntil, now + windowMs)
  }

  pointerDown(): void {
    this.pointerHeld = true
  }

  pointerUp(now: number): void {
    this.pointerHeld = false
    this.note(now)
  }

  isIntentional(now: number): boolean {
    return this.pointerHeld || now <= this.intentUntil
  }
}

/** Keys xterm uses to scroll its own scrollback (Shift+PageUp, Shift+Home, ...). */
export function isScrollbackKey(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey'>): boolean {
  if (!(event.shiftKey || event.metaKey || event.ctrlKey)) return false
  return ['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)
}

/** True when the view sits above the live screen without the user having put it there. */
export function shouldRestoreFollow(
  buffer: { viewportY: number; baseY: number },
  followOutput: boolean
): boolean {
  return followOutput && buffer.viewportY < buffer.baseY
}
