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
