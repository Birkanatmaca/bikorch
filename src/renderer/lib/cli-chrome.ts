import type { PtySessionStatus } from '@shared/contracts/pty'
import type { PanelType } from '@shared/types'

export type CliChromePhase = 'off' | 'idle' | 'busy'

export function getCliChromePhase(
  type: PanelType,
  status: PtySessionStatus | undefined
): CliChromePhase {
  const isCli =
    type === 'cursor' ||
    type === 'claude' ||
    type === 'gemini' ||
    type === 'antigravity' ||
    type === 'codex'
  const isPty = type === 'terminal' || isCli
  if (!isPty) return 'off'

  if (status === 'stopped' || status === 'error') return 'off'
  if (status === 'busy') return 'busy'
  return 'idle'
}

export function cliFrameClass(phase: CliChromePhase): string {
  switch (phase) {
    case 'busy':
      return 'cli-busy-frame'
    case 'idle':
      return 'cli-idle-frame'
    default:
      return ''
  }
}
