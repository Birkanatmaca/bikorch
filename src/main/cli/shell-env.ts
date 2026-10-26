import { execFileSync } from 'child_process'
import { existsSync } from 'fs'

const SKIP_KEYS = new Set([
  'PWD',
  'OLDPWD',
  'SHLVL',
  '_',
  'TERM',
  'TERMINFO',
  'COLUMNS',
  'LINES'
])

/**
 * macOS/Linux GUI launches (Dock / Finder / .app) inherit a minimal PATH.
 * Terminal.app and VS Code load the user's login shell env, so npm/node/brew
 * work there but fail inside Electron unless we bootstrap the same env.
 */
export function loadUserShellEnv(): void {
  if (process.platform === 'win32') return

  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  if (!shell || !existsSync(shell)) return

  try {
    const out = execFileSync(shell, ['-l', '-i', '-c', 'echo __BIKORCH_ENV_START__; env'], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        HOME: process.env.HOME ?? '',
        USER: process.env.USER ?? '',
        LOGNAME: process.env.LOGNAME ?? '',
        SHELL: shell,
        TMPDIR: process.env.TMPDIR ?? '',
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        TERM: 'dumb',
        // Keep oh-my-zsh / tmux plugins from blocking env capture.
        ZSH_TMUX_AUTOSTART: 'false',
        ZSH_TMUX_AUTOSTARTED: '1'
      }
    })

    const marker = '__BIKORCH_ENV_START__'
    const idx = out.indexOf(marker)
    if (idx < 0) return
    const body = out.slice(idx + marker.length)

    for (const line of body.split('\n')) {
      const eq = line.indexOf('=')
      if (eq < 1) continue
      const key = line.slice(0, eq)
      if (!key || SKIP_KEYS.has(key)) continue
      if (key.startsWith('ELECTRON_') || key.startsWith('VITE_') || key.startsWith('npm_')) continue
      process.env[key] = line.slice(eq + 1)
    }
  } catch {
    // Keep the GUI environment; enrichedPath() still adds common tool dirs.
  }
}

/**
 * When Bikorch is started from inside a Claude Code session (its terminal, an
 * agent's shell, a desktop app), it inherits that session's markers, sockets and
 * account ids. Passed on, they make every Claude panel think it is a child of
 * someone else's session: transcripts stop saving and requests can route
 * through the host's proxy. Drop them when that host marker is present.
 */
export function scrubInheritedAgentSession(env: NodeJS.ProcessEnv = process.env): string[] {
  const insideClaudeSession = Boolean(env.CLAUDECODE || env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_CODE_CHILD_SESSION)
  if (!insideClaudeSession) return []
  const removed: string[] = []
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_') || key === 'ANTHROPIC_BASE_URL' || key === 'ANTHROPIC_AUTH_TOKEN') {
      delete env[key]
      removed.push(key)
    }
  }
  return removed
}
