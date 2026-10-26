import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import { CLI_INSTALL_LOG_LINES, isCliInstallationRunning, type CliInstallation, type CliSetupSnapshot } from '@shared/contracts/cli'
import { managedCliPaths } from './managed-paths'

let loaded = false
let installation: CliInstallation | null = null

function save(): void {
  const { root } = managedCliPaths()
  try {
    mkdirSync(root, { recursive: true })
    const path = join(root, 'setup-state.json')
    writeFileSync(`${path}.tmp`, JSON.stringify(installation), 'utf8')
    renameSync(`${path}.tmp`, path)
  } catch (error) {
    console.warn('[cli] Could not persist installation status:', error instanceof Error ? error.message : 'filesystem error')
  }
}

export function getCliSetupSnapshot(): CliSetupSnapshot {
  if (!loaded) {
    loaded = true
    try {
      const path = join(managedCliPaths().root, 'setup-state.json')
      const stored = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
      if (stored && AI_ACCOUNT_KINDS.includes(stored.kind) &&
        ['checking', 'runtime', 'installing', 'verifying', 'complete', 'failed', 'interrupted'].includes(stored.phase) &&
        Number.isFinite(stored.startedAt) && Number.isFinite(stored.updatedAt)) {
        installation = { kind: stored.kind, phase: stored.phase, startedAt: stored.startedAt, updatedAt: stored.updatedAt,
          ...(stored.mode === 'install' || stored.mode === 'update' ? { mode: stored.mode } : {}),
          ...(Array.isArray(stored.log)
            ? { log: stored.log.filter((line: unknown) => typeof line === 'string').slice(-CLI_INSTALL_LOG_LINES) }
            : {}),
          ...(typeof stored.error === 'string' ? { error: stored.error.slice(0, 600) } : {}) }
        if (isCliInstallationRunning(installation)) {
          installation = { ...installation!, phase: 'interrupted', updatedAt: Date.now(), error: 'Installation was interrupted. Click download to continue.' }
          save()
        }
      }
    } catch { installation = null }
  }
  return { installation: installation ? { ...installation } : null }
}

export function setCliInstallation(next: CliInstallation): void {
  getCliSetupSnapshot()
  installation = next
  save()
}
