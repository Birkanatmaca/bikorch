import type { CliUsageKind } from './usage'

export interface CliDetection {
  installed: boolean
  command: string | null
  error?: string
}

export type CliInstallPhase = 'checking' | 'runtime' | 'installing' | 'verifying' | 'complete' | 'failed' | 'interrupted'
export interface CliInstallation {
  kind: CliUsageKind
  phase: CliInstallPhase
  startedAt: number
  updatedAt: number
  error?: string
}
export interface CliSetupSnapshot { installation: CliInstallation | null }
export function isCliInstallationRunning(installation: CliInstallation | null): boolean {
  return installation !== null && ['checking', 'runtime', 'installing', 'verifying'].includes(installation.phase)
}
