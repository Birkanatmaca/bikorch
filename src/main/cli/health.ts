import { execFile } from 'child_process'
import { homedir } from 'os'
import { promisify } from 'util'
import type { CliUsageKind } from '@shared/contracts/usage'
import type { CliDetection } from '@shared/contracts/cli'
import { AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import { resolveSpawnConfigCandidates, terminalUserEnv, type SpawnConfig } from './adapters'
import { appendCliArgs } from './spawn-args'

const execFileAsync = promisify(execFile)
const pending = new Map<CliUsageKind, Promise<CliDetection>>()

export function cliVersionArgs(config: SpawnConfig): string[] {
  return appendCliArgs(config, ['--version'])
}

async function inspect(kind: CliUsageKind): Promise<CliDetection> {
  let candidates: SpawnConfig[]
  try { candidates = resolveSpawnConfigCandidates(kind) }
  catch { return { installed: false, command: null, error: `${AI_ACCOUNT_LABELS[kind]} could not be checked. Retry installation.` } }
  if (candidates.length === 0) return { installed: false, command: null }
  const deadline = Date.now() + 16_000
  for (const config of candidates) {
    const timeout = Math.min(8_000, deadline - Date.now())
    if (timeout <= 0) break
    try {
      const { stdout, stderr } = await execFileAsync(config.command, cliVersionArgs(config), {
        cwd: homedir(), env: { ...terminalUserEnv(), ...config.env }, windowsHide: true, timeout, maxBuffer: 256 * 1024
      })
      if (!/\d+\.\d+/.test(`${stdout}\n${stderr}`)) continue
      return { installed: true, command: [config.command, ...config.args].join(' ') }
    } catch {
      // Try the next launcher; a stale wrapper must not hide a working runtime.
    }
  }
  return { installed: false, command: null, error: `${AI_ACCOUNT_LABELS[kind]} is present but could not start. Download it again to repair the installation.` }
}

export function inspectCli(kind: CliUsageKind): Promise<CliDetection> {
  const existing = pending.get(kind)
  if (existing) return existing
  const promise = inspect(kind).finally(() => { pending.delete(kind) })
  pending.set(kind, promise)
  return promise
}
