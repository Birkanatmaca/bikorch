import type { PtyKind } from '@shared/contracts/pty'
import { getTerminalOptions } from '@renderer/lib/terminal-theme'

interface LiveTerminalHandle {
  options: { scrollback?: number }
  rows?: number
  buffer?: {
    active: {
      viewportY: number
      getLine: (row: number) => { translateToString: (trimRight?: boolean) => string } | undefined
    }
  }
}

const live = new Map<string, { kind: PtyKind; terminal: LiveTerminalHandle }>()

export function registerLiveTerminal(id: string, kind: PtyKind, terminal: LiveTerminalHandle): void {
  live.set(id, { kind, terminal })
}

export function unregisterLiveTerminal(id: string): void {
  live.delete(id)
}

export function applyLiveTerminalScrollback(): void {
  for (const { kind, terminal } of live.values()) {
    const next = getTerminalOptions(kind).scrollback
    if (typeof next === 'number') terminal.options.scrollback = next
  }
}

export function liveTerminalCount(): number {
  return live.size
}

/**
 * The text a terminal shows right now, row by row. TUIs (Claude Code, Codex,
 * Gemini) draw menus with cursor moves, so the raw output stream glues options
 * onto one line; the rendered screen keeps "❯ No, exit" and "Yes, …" apart.
 */
export function liveTerminalScreen(id: string): string | null {
  const handle = live.get(id)?.terminal
  const buffer = handle?.buffer?.active
  if (!buffer || !handle.rows) return null
  const lines: string[] = []
  for (let row = 0; row < handle.rows; row += 1) {
    lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '')
  }
  return lines.join('\n').replace(/\n+$/, '')
}
