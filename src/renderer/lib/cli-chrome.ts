import type { PtySessionStatus } from '@shared/contracts/pty'
import type { PanelType } from '@shared/types'

export type CliChromePhase = 'off' | 'starting' | 'running' | 'waiting' | 'busy'

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
  if (status === 'busy') return isCli ? 'busy' : 'running'
  if (status === 'waiting') return isCli ? 'waiting' : 'running'
  if (status === 'starting') return 'starting'
  if (isCli) return 'waiting'
  return 'running'
}

export function cliFrameClass(phase: CliChromePhase): string {
  switch (phase) {
    case 'busy':
      return 'cli-busy-frame'
    case 'waiting':
    case 'starting':
    case 'running':
      return 'cli-live-frame'
    default:
      return ''
  }
}
