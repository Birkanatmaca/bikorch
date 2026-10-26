import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, resolve, sep } from 'path'
import { promisify } from 'util'
import type { CliUsageKind } from '@shared/contracts/usage'
import { parseCliVersion, type CliDetection } from '@shared/contracts/cli'
import { AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import { resolveSpawnConfigCandidates, setGeminiSkipTrustSupport, terminalUserEnv, type SpawnConfig } from './adapters'
import { appendCliArgs } from './spawn-args'
import { managedCliPaths } from './managed-paths'

const execFileAsync = promisify(execFile)
const pending = new Map<CliUsageKind, Promise<CliDetection>>()

export function cliVersionArgs(config: SpawnConfig): string[] {
  return appendCliArgs(config, ['--version'])
}

function isManagedCommand(command: string): boolean {
  const root = resolve(managedCliPaths().root) + sep
  return resolve(command).startsWith(root)
}

/**
 * Claude Code on Windows runs its tools through Git Bash. `claude --version`
 * works without it, so check explicitly or the CLI looks installed and then
 * fails on first use.
 */
export function findWindowsGitBash(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.CLAUDE_CODE_GIT_BASH_PATH
  if (configured && existsSync(configured)) return configured
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')]
  for (const root of roots) {
    if (!root) continue
    const candidate = join(root, 'Git', 'bin', 'bash.exe')
    if (existsSync(candidate)) return candidate
  }
  return null
}

export const GIT_BASH_REQUIRED_MESSAGE =
  'Claude Code on Windows needs Git for Windows (Git Bash). Install it from https://git-scm.com/downloads/win, then check again.'

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
      const version = parseCliVersion(`${stdout}\n${stderr}`)
      if (!version) continue
      const command = [config.command, ...config.args].join(' ')
      const managed = [config.command, ...config.args].some((part) => isManagedCommand(part))
      // Off the critical path: detection answers now; launches pick the flag up once known.
      if (kind === 'gemini') {
        void execFileAsync(config.command, appendCliArgs(config, ['--help']), {
          cwd: homedir(), env: { ...terminalUserEnv(), ...config.env }, windowsHide: true, timeout: 8_000, maxBuffer: 512 * 1024
        }).then(
          (help) => setGeminiSkipTrustSupport(/--skip-trust\b/.test(`${help.stdout}\n${help.stderr}`)),
          () => undefined
        )
      }
      if (kind === 'claude' && process.platform === 'win32' && !findWindowsGitBash()) {
        return { installed: false, command, version, managed, error: GIT_BASH_REQUIRED_MESSAGE }
      }
      return { installed: true, command, version, managed }
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
