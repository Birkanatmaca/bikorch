import { execFile } from 'child_process'
import { promisify } from 'util'
import { homedir } from 'os'
import type { CliUsageKind } from '@shared/contracts/usage'
import { AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import { terminalUserEnv } from './adapters'
import { ensureManagedNode } from './install-runtime'
import { installManagedPackage } from './install-package'
import { inspectCli } from './health'
import { getCliSetupSnapshot, setCliInstallation } from './install-state'
import type { CliInstallPhase } from '@shared/contracts/cli'
import { initializeManagedSetup } from './setup-recovery'

const execFileAsync = promisify(execFile)

type InstallResult = { ok: boolean; error?: string }
let installation: { kind: CliUsageKind; promise: Promise<InstallResult> } | null = null

// Official install instructions: cursor.com/docs/cli/installation,
// code.claude.com/docs/en/setup, antigravity.google/docs/cli/install/,
// geminicli.com/docs/get-started/installation/ and github.com/openai/codex.
const NATIVE_INSTALLERS = {
  cursor: { windows: 'https://cursor.com/install?win32=true', unix: 'https://cursor.com/install' },
  claude: { windows: 'https://claude.ai/install.ps1', unix: 'https://claude.ai/install.sh' },
  antigravity: { windows: 'https://antigravity.google/cli/install.ps1', unix: 'https://antigravity.google/cli/install.sh' }
} as const

async function performInstall(kind: CliUsageKind): Promise<InstallResult> {
  const startedAt = Date.now()
  const phase = (value: CliInstallPhase, error?: string): void => setCliInstallation({ kind, phase: value, startedAt, updatedAt: Date.now(), ...(error ? { error } : {}) })
  try {
    phase('checking')
    await initializeManagedSetup()
    if ((await inspectCli(kind)).installed) { phase('complete'); return { ok: true } }
    if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
      throw new Error('Automatic CLI installation is unavailable on this operating system')
    }
    if (kind === 'gemini' || kind === 'codex') {
      phase('runtime')
      await ensureManagedNode()
      phase('installing')
      await installManagedPackage(kind, () => phase('verifying'))
    } else {
      phase('installing')
      const installer = NATIVE_INSTALLERS[kind]
      const windows = process.platform === 'win32'
      await execFileAsync(windows ? 'powershell.exe' : '/bin/bash', windows ? [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        `$ErrorActionPreference = 'Stop'; irm '${installer.windows}' | iex`
      ] : ['-o', 'pipefail', '-c', `curl -fsSL '${installer.unix}' | bash`], {
        cwd: homedir(), env: terminalUserEnv(), windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024
      })
    }
    phase('verifying')
    const health = await inspectCli(kind)
    if (!health.installed) throw new Error(health.error || 'Installation finished but the CLI executable could not be found. Try again.')
    phase('complete')
    return { ok: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Installation failed'
    const message = `${AI_ACCOUNT_LABELS[kind]} could not be installed: ${detail}`
    phase('failed', message)
    return { ok: false, error: message }
  }
}

export function installCli(kind: CliUsageKind): Promise<InstallResult> {
  getCliSetupSnapshot()
  if (installation) {
    return installation.kind === kind ? installation.promise : Promise.resolve({ ok: false, error: 'Another CLI is being installed. Wait for it to finish.' })
  }
  const promise = performInstall(kind).finally(() => { installation = null })
  installation = { kind, promise }
  return promise
}
