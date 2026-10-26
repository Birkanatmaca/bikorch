import { homedir } from 'os'
import type { CliUsageKind } from '@shared/contracts/usage'
import { AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import {
  CLI_INSTALL_LOG_LINES,
  type CliInstallMode,
  type CliInstallPhase,
  type CliInstallResult,
  type CliUninstallResult
} from '@shared/contracts/cli'
import { terminalUserEnv } from './adapters'
import { ensureManagedNode } from './install-runtime'
import { installManagedPackage, uninstallManagedPackage } from './install-package'
import { inspectCli } from './health'
import { getCliSetupSnapshot, setCliInstallation } from './install-state'
import { initializeManagedSetup } from './setup-recovery'
import { InstallCancelledError, runLogged } from './run-logged'

let installation: {
  kind: CliUsageKind
  controller: AbortController
  promise: Promise<CliInstallResult>
} | null = null

// Official install instructions: cursor.com/docs/cli/installation,
// code.claude.com/docs/en/setup, antigravity.google/docs/cli/install/,
// geminicli.com/docs/get-started/installation/ and github.com/openai/codex.
// Re-running these installers is also the documented way to update.
const NATIVE_INSTALLERS = {
  cursor: { windows: 'https://cursor.com/install?win32=true', unix: 'https://cursor.com/install' },
  claude: { windows: 'https://claude.ai/install.ps1', unix: 'https://claude.ai/install.sh' },
  antigravity: { windows: 'https://antigravity.google/cli/install.ps1', unix: 'https://antigravity.google/cli/install.sh' }
} as const

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

async function performInstall(
  kind: CliUsageKind,
  mode: CliInstallMode,
  signal: AbortSignal
): Promise<CliInstallResult> {
  const startedAt = Date.now()
  const log: string[] = []
  let current: CliInstallPhase = 'checking'
  let lastSavedAt = 0
  const save = (error?: string): void => {
    lastSavedAt = Date.now()
    setCliInstallation({
      kind,
      phase: current,
      mode,
      startedAt,
      updatedAt: lastSavedAt,
      log: [...log],
      ...(error ? { error } : {})
    })
  }
  const phase = (value: CliInstallPhase, error?: string): void => {
    current = value
    save(error)
  }
  // Installer output can be chatty; persist it at most a few times a second.
  const onLine = (line: string): void => {
    log.push(line)
    if (log.length > CLI_INSTALL_LOG_LINES) log.splice(0, log.length - CLI_INSTALL_LOG_LINES)
    if (Date.now() - lastSavedAt > 300) save()
  }

  try {
    phase('checking')
    await initializeManagedSetup()
    if (mode === 'install' && (await inspectCli(kind)).installed) {
      phase('complete')
      return { ok: true }
    }
    if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
      throw new Error('Automatic CLI installation is unavailable on this operating system')
    }
    if (kind === 'gemini' || kind === 'codex') {
      phase('runtime')
      onLine('Preparing the Node.js runtime Bikorch uses for this CLI…')
      await ensureManagedNode()
      if (signal.aborted) throw new InstallCancelledError()
      phase('installing')
      await installManagedPackage(kind, () => phase('verifying'), { signal, onLine })
    } else {
      phase('installing')
      const installer = NATIVE_INSTALLERS[kind]
      const windows = process.platform === 'win32'
      onLine(`Running the official installer: ${windows ? installer.windows : installer.unix}`)
      await runLogged(
        windows ? 'powershell.exe' : '/bin/bash',
        windows
          ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
            `$ErrorActionPreference = 'Stop'; irm '${installer.windows}' | iex`]
          : ['-o', 'pipefail', '-c', `curl -fsSL '${installer.unix}' | bash`],
        { cwd: homedir(), env: terminalUserEnv(), windowsHide: true, timeoutMs: INSTALL_TIMEOUT_MS, signal, onLine }
      )
    }
    phase('verifying')
    const health = await inspectCli(kind)
    if (!health.installed) throw new Error(health.error || 'Installation finished but the CLI executable could not be found. Try again.')
    if (health.version) onLine(`${AI_ACCOUNT_LABELS[kind]} ${health.version} is ready.`)
    phase('complete')
    return { ok: true }
  } catch (error) {
    if (error instanceof InstallCancelledError || signal.aborted) {
      const message = `${AI_ACCOUNT_LABELS[kind]} ${mode === 'update' ? 'update' : 'installation'} was cancelled.`
      phase('failed', message)
      return { ok: false, cancelled: true, error: message }
    }
    const detail = error instanceof Error ? error.message : 'Installation failed'
    const verb = mode === 'update' ? 'updated' : 'installed'
    const message = `${AI_ACCOUNT_LABELS[kind]} could not be ${verb}: ${detail}`.slice(0, 600)
    phase('failed', message)
    return { ok: false, error: message }
  }
}

export function installCli(kind: CliUsageKind, mode: CliInstallMode = 'install'): Promise<CliInstallResult> {
  getCliSetupSnapshot()
  if (installation) {
    return installation.kind === kind
      ? installation.promise
      : Promise.resolve({
          ok: false,
          error: `${AI_ACCOUNT_LABELS[installation.kind]} is being installed. Wait for it to finish, then try again.`
        })
  }
  const controller = new AbortController()
  const promise = performInstall(kind, mode, controller.signal).finally(() => { installation = null })
  installation = { kind, controller, promise }
  return promise
}

export function cancelCliInstall(kind: CliUsageKind): boolean {
  if (!installation || installation.kind !== kind) return false
  installation.controller.abort()
  return true
}

export async function uninstallCli(kind: CliUsageKind): Promise<CliUninstallResult> {
  if (installation?.kind === kind) return { ok: false, error: 'Wait for the current installation to finish first.' }
  if (kind !== 'gemini' && kind !== 'codex') {
    return { ok: false, error: `${AI_ACCOUNT_LABELS[kind]} was installed by its official installer. Remove it with that tool's own uninstall steps.` }
  }
  const health = await inspectCli(kind)
  if (health.installed && !health.managed) {
    return { ok: false, error: `This ${AI_ACCOUNT_LABELS[kind]} was not installed by Bikorch, so Bikorch leaves it in place.` }
  }
  try {
    await uninstallManagedPackage(kind)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not remove the CLI' }
  }
}
