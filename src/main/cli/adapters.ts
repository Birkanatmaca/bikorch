import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { type PtyKind } from '@shared/contracts/pty'

export interface SpawnConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

function localAppData(): string {
  return process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
}

function pushExistingVersionBins(dirs: string[], versionsRoot: string): void {
  if (!existsSync(versionsRoot)) return
  try {
    for (const name of readdirSync(versionsRoot)) {
      const bin = join(versionsRoot, name, 'bin')
      dirs.push(existsSync(bin) ? bin : join(versionsRoot, name))
    }
  } catch {
    // ignore unreadable version dirs
  }
}

function extraCliDirs(): string[] {
  const local = localAppData()
  const roaming = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  const home = homedir()
  const dirs = [
    // macOS / Linux — GUI apps (Dock/Finder) often miss these until shell env is loaded.
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    join(home, '.nvm', 'current', 'bin'),
    join(home, '.fnm', 'current', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.local', 'share', 'cursor-agent'),
    join(home, '.cursor', 'bin'),
    // Windows
    join(local, 'cursor-agent'),
    join(local, 'agy', 'bin'),
    join(roaming, 'npm'),
    join(local, 'Programs', 'cursor', 'resources', 'app', 'bin'),
    join(local, 'Programs', 'Cursor', 'resources', 'app', 'bin'),
    'C:\\Program Files\\cursor\\resources\\app\\bin',
    'C:\\Program Files\\Cursor\\resources\\app\\bin'
  ]

  // nvm rarely creates `current`; prefer the newest installed Node bin.
  pushExistingVersionBins(dirs, join(home, '.nvm', 'versions', 'node'))
  pushExistingVersionBins(dirs, join(local, 'cursor-agent', 'versions'))
  pushExistingVersionBins(dirs, join(local, 'OpenAI', 'Codex', 'bin'))

  return dirs.filter((dir) => existsSync(dir))
}

export function enrichedPath(): string {
  const delimiter = process.platform === 'win32' ? ';' : ':'
  const current = process.env.PATH ?? ''
  const seen = new Set<string>()
  const parts: string[] = []

  // Prefer user tool dirs over the minimal GUI PATH so npm/node/brew resolve.
  for (const part of [...extraCliDirs(), ...current.split(delimiter)]) {
    if (!part || seen.has(part)) continue
    seen.add(part)
    parts.push(part)
  }

  return parts.join(delimiter)
}

export function spawnEnv(): Record<string, string> {
  const env = { ...(process.env as Record<string, string>) }
  delete env.NO_COLOR
  delete env.CI

  return {
    ...env,
    PATH: enrichedPath(),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3',
    CLICOLOR: '1',
    CLICOLOR_FORCE: '1'
  }
}

function findOnDisk(names: string[]): string | null {
  const delimiter = process.platform === 'win32' ? ';' : ':'
  const dirs = enrichedPath().split(delimiter)

  for (const dir of dirs) {
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }

  return null
}

export function getDefaultShell(): SpawnConfig {
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (existsSync(powershell)) {
      return {
        command: powershell,
        args: ['-NoLogo']
      }
    }

    return {
      command: process.env.COMSPEC ?? 'cmd.exe',
      args: []
    }
  }

  // Login shell so .zprofile / .bash_profile (Homebrew, nvm, PATH) load the
  // same way as Terminal.app — non-login shells inherit Electron's GUI PATH.
  return {
    command: process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'),
    args: ['-l']
  }
}

function quoteWinCmdArg(value: string): string {
  if (!/[\s"]|[^\x00-\x7F]/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

function windowsCmdSpawn(scriptPath: string, extraArgs: string[] = []): SpawnConfig {
  const commandLine = [quoteWinCmdArg(scriptPath), ...extraArgs.map(quoteWinCmdArg)].join(' ')
  return {
    command: process.env.COMSPEC ?? 'cmd.exe',
    args: ['/d', '/s', '/c', commandLine]
  }
}

function windowsPowerShellSpawn(scriptPath: string, extraArgs: string[] = []): SpawnConfig {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return {
    command: existsSync(powershell) ? powershell : 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...extraArgs]
  }
}

const CURSOR_VERSION_DIR_RE = /^\d{4}\.\d{1,2}\.\d{1,2}(?:-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/i

function cursorVersionSortKey(name: string): number {
  const [year = '0', month = '0', day = '0'] = name.split('-')[0]?.split('.') ?? []
  return Number(`${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`) || 0
}

function latestCursorAgentRuntime(): SpawnConfig | null {
  const versionsRoot = join(localAppData(), 'cursor-agent', 'versions')
  if (!existsSync(versionsRoot)) return null
  const latest = readdirSync(versionsRoot)
    .filter((name) => {
      if (!CURSOR_VERSION_DIR_RE.test(name)) return false
      const dir = join(versionsRoot, name)
      return existsSync(join(dir, 'node.exe')) && existsSync(join(dir, 'index.js'))
    })
    .sort((left, right) => cursorVersionSortKey(right) - cursorVersionSortKey(left))[0]
  if (!latest) return null
  const dir = join(versionsRoot, latest)
  return {
    command: join(dir, 'node.exe'),
    args: [join(dir, 'index.js')],
    env: { CURSOR_INVOKED_AS: 'agent' }
  }
}

function resolveCursorSpawnCandidates(): SpawnConfig[] {
  if (process.platform !== 'win32') {
    const unixAgent = findOnDisk(['cursor-agent', 'agent', 'cursor'])
    if (!unixAgent) return []
    if (unixAgent.endsWith('cursor') && !unixAgent.includes('cursor-agent')) {
      return [{ command: unixAgent, args: ['agent'] }]
    }
    return [{ command: unixAgent, args: [] }]
  }

  const candidates: SpawnConfig[] = []
  const runtime = latestCursorAgentRuntime()
  if (runtime) candidates.push(runtime)

  const powershellAgent = findOnDisk(['cursor-agent.ps1', 'agent.ps1'])
  if (powershellAgent) candidates.push(windowsPowerShellSpawn(powershellAgent))

  const agentCmd = findOnDisk(['agent.cmd', 'cursor-agent.cmd', 'agent.exe', 'cursor-agent.exe'])
  if (agentCmd) candidates.push(windowsCmdSpawn(agentCmd))

  const cursor = findOnDisk(['cursor.cmd', 'cursor.exe'])
  if (cursor) candidates.push(windowsCmdSpawn(cursor, ['agent']))

  return candidates
}

function resolveCursorSpawn(): SpawnConfig | null {
  return resolveCursorSpawnCandidates()[0] ?? null
}

function resolveClaudeSpawn(): SpawnConfig | null {
  if (process.platform === 'win32') {
    const claude = findOnDisk(['claude.cmd', 'claude.exe'])
    if (!claude) return null
    return windowsCmdSpawn(claude)
  }

  const claude = findOnDisk(['claude'])
  if (!claude) return null
  return { command: claude, args: [] }
}

function resolveGeminiSpawn(): SpawnConfig | null {
  if (process.platform === 'win32') {
    const gemini = findOnDisk(['gemini.cmd', 'gemini.exe', 'gemini'])
    if (!gemini) return null
    return windowsCmdSpawn(gemini)
  }

  const gemini = findOnDisk(['gemini'])
  if (!gemini) return null
  return { command: gemini, args: [] }
}

function resolveAntigravitySpawn(): SpawnConfig | null {
  if (process.platform === 'win32') {
    const agy = findOnDisk(['agy.exe', 'agy.cmd', 'agy'])
    if (!agy) return null
    return windowsCmdSpawn(agy)
  }

  const agy = findOnDisk(['agy'])
  if (!agy) return null
  return { command: agy, args: [] }
}

function resolveCodexSpawn(): SpawnConfig | null {
  if (process.platform === 'win32') {
    const codex = findOnDisk(['codex.exe', 'codex.cmd', 'codex'])
    if (!codex) return null
    return windowsCmdSpawn(codex)
  }

  const codex = findOnDisk(['codex'])
  if (!codex) return null
  return { command: codex, args: [] }
}

export function detectCli(kind: Exclude<PtyKind, 'terminal'>): {
  installed: boolean
  command: string | null
} {
  const config =
    kind === 'cursor'
      ? resolveCursorSpawn()
      : kind === 'claude'
        ? resolveClaudeSpawn()
        : kind === 'gemini'
          ? resolveGeminiSpawn()
          : kind === 'antigravity'
            ? resolveAntigravitySpawn()
            : resolveCodexSpawn()
  return {
    installed: config !== null,
    command: config ? [config.command, ...config.args].join(' ') : null
  }
}

export function resolveSpawnConfigCandidates(kind: PtyKind): SpawnConfig[] {
  if (kind === 'terminal') {
    return [getDefaultShell()]
  }

  if (kind === 'cursor') {
    return resolveCursorSpawnCandidates()
  }

  if (kind === 'claude') {
    const claude = resolveClaudeSpawn()
    return claude ? [claude] : []
  }

  if (kind === 'gemini') {
    const gemini = resolveGeminiSpawn()
    return gemini ? [gemini] : []
  }

  if (kind === 'antigravity') {
    const agy = resolveAntigravitySpawn()
    return agy ? [agy] : []
  }

  if (kind === 'codex') {
    const codex = resolveCodexSpawn()
    return codex ? [codex] : []
  }

  return [getDefaultShell()]
}

export function resolveSpawnConfig(kind: PtyKind): SpawnConfig {
  return resolveSpawnConfigCandidates(kind)[0] ?? getDefaultShell()
}

export function windowsPtySpawnOptions(): Array<{ useConpty?: boolean }> {
  if (process.platform !== 'win32') return [{}]
  // ConPTY handles Unicode user paths; winpty is the fallback after AttachConsole failures.
  return [{ useConpty: true }, { useConpty: false }]
}

export function cliLaunchArgs(
  kind: PtyKind,
  launchMode: 'normal' | 'login' = 'normal',
  cliModel?: string
): string[] {
  if (launchMode === 'login' && (kind === 'codex' || kind === 'cursor')) return ['login']
  if (kind === 'cursor') return cliModel ? ['--trust', '--model', cliModel] : ['--trust']
  if (kind === 'gemini') return ['--skip-trust']
  return []
}

export function getKindLabel(kind: PtyKind): string {
  switch (kind) {
    case 'terminal':
      return 'Terminal'
    case 'claude':
      return 'Claude Code'
    case 'cursor':
      return 'Cursor CLI'
    case 'gemini':
      return 'Gemini CLI'
    case 'antigravity':
      return 'Antigravity CLI'
    case 'codex':
      return 'Codex CLI'
  }
}
