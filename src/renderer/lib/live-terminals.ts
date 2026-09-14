import type { PtyKind } from '@shared/contracts/pty'
import { getTerminalOptions } from '@renderer/lib/terminal-theme'

interface LiveTerminalHandle {
  options: { scrollback?: number }
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
