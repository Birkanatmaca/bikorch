import type { CliUsageKind } from './usage'

export interface CliDetection {
  installed: boolean
  command: string | null
  /** Version reported by `--version`, when it could be parsed. */
  version?: string
  /** Installed by Bikorch under ~/.bikorch/cli, so Bikorch can update or remove it. */
  managed?: boolean
  error?: string
}

export type CliInstallMode = 'install' | 'update'
export type CliInstallPhase = 'checking' | 'runtime' | 'installing' | 'verifying' | 'complete' | 'failed' | 'interrupted'
export interface CliInstallation {
  kind: CliUsageKind
  phase: CliInstallPhase
  startedAt: number
  updatedAt: number
  mode?: CliInstallMode
  /** Most recent installer output lines, newest last. */
  log?: string[]
  error?: string
}
export interface CliSetupSnapshot { installation: CliInstallation | null }
export interface CliInstallResult { ok: boolean; error?: string; cancelled?: boolean }
export interface CliUninstallResult { ok: boolean; error?: string }

export const CLI_INSTALL_LOG_LINES = 200

export function isCliInstallationRunning(installation: CliInstallation | null): boolean {
  return installation !== null && ['checking', 'runtime', 'installing', 'verifying'].includes(installation.phase)
}

/** Pulls a version like `1.2.3` or `2.0.14-beta.1` out of `--version` output. */
export function parseCliVersion(output: string): string | undefined {
  return /\b(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.]+)?)\b/.exec(output)?.[1]
}
