const ANSI_RE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const TRUST_RE = /workspace trust required|trust this workspace|do you trust the (?:files|contents) (?:of|in) this (?:directory|project|folder)|i trust this folder|is this a project you created or one you trust/i
const MANAGED_WORKTREE_RE = /\/Bikorch\/agent-worktrees\//i

const READ_BINS = new Set([
  'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'which', 'whereis',
  'whoami', 'id', 'uname', 'date', 'echo', 'printf', 'rg', 'grep', 'egrep', 'fgrep'
])

/** Tools whose appearance must be classified. Anything else is not auto-approved. */
const RECOGNIZED_BINS = new Set([
  ...READ_BINS,
  'find', 'git', 'kubectl', 'terraform', 'docker', 'npm', 'pnpm', 'yarn',
  'rm', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown', 'sudo', 'doas', 'kill',
  'curl', 'wget', 'ssh', 'scp', 'npx', 'make', 'python', 'python3', 'node', 'bash', 'sh', 'zsh'
])

const CHROME_RE = /^(?:allow|deny|yes|no|y|n|approve|accept|continue|run this|allow this|press enter|press return|hit enter|press any key|do you want|would you like)\b|^\(?y\/n\)?$|^yes\/no$|^\[y\]es\b/i

function basename(token: string): string {
  return token.split(/[\\/]/).pop()?.toLowerCase() ?? token.toLowerCase()
}

function tokenize(input: string): string[] | null {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    if ('|&;<>`()'.includes(char) || char === '$') return null
    current += char
  }
  if (quote) return null
  if (current) tokens.push(current)
  return tokens
}

function isReadOnlyGit(args: string[]): boolean {
  const sub = args.find((arg) => !arg.startsWith('-'))
  if (!sub) return false
  const rest = args.slice(args.indexOf(sub) + 1)
  if ([
    'status', 'diff', 'log', 'show', 'blame', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree',
    'shortlog', 'describe', 'grep', 'check-ignore', 'merge-base', 'name-rev', 'version', 'help', 'reflog'
  ].includes(sub)) return true
  if (sub === 'remote') {
    const action = rest.find((arg) => !arg.startsWith('-'))
    return !action || action === 'show' || action === 'get-url'
  }
  if (sub === 'branch') {
    return rest.every((arg) => ['--list', '--show-current', '-a', '-r'].includes(arg))
  }
  if (sub === 'tag') {
    return rest.filter((arg) => !arg.startsWith('-')).length === 0
      && !args.some((arg) => ['-d', '-a', '-s', '-u', '-f', '--delete'].includes(arg))
  }
  if (sub === 'stash') {
    const action = rest.find((arg) => !arg.startsWith('-'))
    return !action || action === 'list' || action === 'show'
  }
  if (sub === 'config') {
    const reads = args.some((arg) => ['--get', '--list', '--get-regexp', '--get-all', '-l'].includes(arg))
    const writes = args.some((arg) => ['--set', '--unset', '--unset-all', '--add', '--replace-all', '--edit', '--remove-section'].includes(arg))
    return reads && !writes
  }
  return false
}

function isReadOnlyKubectl(args: string[]): boolean {
  const sub = args.find((arg) => !arg.startsWith('-'))
  if (!sub) return false
  if (['get', 'describe', 'logs', 'explain', 'api-resources', 'api-versions', 'version', 'cluster-info'].includes(sub)) return true
  if (sub === 'auth') return args.some((arg) => arg === 'can-i' || arg === 'whoami')
  if (sub === 'config') return args.some((arg) => arg === 'view' || arg === 'current-context')
  return false
}

function isReadOnlyTerraform(args: string[]): boolean {
  const sub = args.find((arg) => !arg.startsWith('-'))
  if (!sub) return false
  if (sub === 'plan') return !args.some((arg) => arg === '-out' || arg.startsWith('-out='))
  if (sub === 'show' || sub === 'version' || sub === 'validate' || sub === 'output' || sub === 'providers' || sub === 'graph') return true
  if (sub === 'fmt') return args.includes('-check')
  if (sub === 'state') {
    const action = args.slice(args.indexOf(sub) + 1).find((arg) => !arg.startsWith('-'))
    return action === 'list' || action === 'show'
  }
  return false
}

function isReadOnlyDocker(args: string[]): boolean {
  const sub = args.find((arg) => !arg.startsWith('-'))
  if (!sub) return false
  if (['ps', 'images', 'inspect', 'logs', 'version', 'info', 'top', 'port', 'history'].includes(sub)) return true
  if (sub === 'image' || sub === 'container') {
    const action = args.slice(args.indexOf(sub) + 1).find((arg) => !arg.startsWith('-'))
    return action === 'ls' || action === 'list' || action === 'inspect'
  }
  return false
}

function isReadOnlyPackage(bin: string, args: string[]): boolean {
  const sub = args.find((arg) => !arg.startsWith('-'))
  if (!sub) return bin === 'npm' && args.includes('--version')
  if (['view', 'info', 'show', 'ls', 'list', 'outdated', 'explain', 'why', 'ping', 'prefix', 'root', 'help'].includes(sub)) return true
  if (sub === 'version') return args.filter((arg) => !arg.startsWith('-')).length === 1
  if (sub === 'config') {
    const action = args.slice(args.indexOf(sub) + 1).find((arg) => !arg.startsWith('-'))
    return action === 'get' || action === 'list'
  }
  return false
}

function isReadOnlyFind(args: string[]): boolean {
  return !args.some((arg) => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fls', '-fprintf'].includes(arg))
}

/** True only for a single read-only command. Shell composition is refused. */
export function isReadOnlyCliCommand(command: string): boolean {
  const tokens = tokenize(command.trim())
  if (!tokens || tokens.length === 0) return false
  const bin = basename(tokens[0])
  const args = tokens.slice(1)
  if (READ_BINS.has(bin)) {
    return bin === 'rg' || bin === 'grep' || bin === 'egrep' || bin === 'fgrep'
      ? !args.some((arg) => arg === '--pre' || arg.startsWith('--pre='))
      : true
  }
  if (bin === 'find') return isReadOnlyFind(args)
  if (bin === 'git') return isReadOnlyGit(args)
  if (bin === 'kubectl') return isReadOnlyKubectl(args)
  if (bin === 'terraform') return isReadOnlyTerraform(args)
  if (bin === 'docker') return isReadOnlyDocker(args)
  if (bin === 'npm' || bin === 'pnpm' || bin === 'yarn') return isReadOnlyPackage(bin, args)
  return false
}

function commandLines(tail: string): string[] {
  return tail.split('\n').slice(-10).flatMap((line) => {
    const text = line.replace(/^[\s❯›▶▸>•*\d.)\-[\]]+/, '').trim()
    if (!text || CHROME_RE.test(text) || text.length > 240) return []
    const tokens = tokenize(text)
    if (!tokens || !RECOGNIZED_BINS.has(basename(tokens[0]))) return []
    return [text]
  })
}

export function looksWorkspaceTrustPrompt(buffer: string): boolean {
  return TRUST_RE.test(buffer.replace(ANSI_RE, '').replace(/\r/g, ''))
}

/** Down arrow, then Enter: moves a menu from its default "No" to "Yes" and confirms. */
export const TRUST_DOWN_THEN_ENTER = '\u001b[B\r'

export type CliPermissionKeys = '\r' | 'y\r' | 'a\r' | typeof TRUST_DOWN_THEN_ENTER

/** Terminal writes for a response; menus need a pause between moving and confirming. */
export function permissionKeystrokes(keys: CliPermissionKeys): string[] {
  return keys === TRUST_DOWN_THEN_ENTER ? ['\u001b[B', '\r'] : [keys]
}

const SELECTED_RE = /^(?:>|❯|▶|▸|›|●)\s*(?:\d+\.\s*)?(.*)$/
const DECLINE_RE = /^(?:no\b|don'?t trust|do not trust|quit|exit)/i
const ACCEPT_RE = /^(?:yes\b|trust folder|trust this|i trust)/i

/**
 * Confirms folder trust only for a Bikorch agent worktree, and only by choosing
 * the option that trusts that exact folder:
 * - Claude Code: "❯ No, exit / Yes, I trust this folder" (No is the default)
 * - Codex: "› 1. Yes, continue / 2. No, quit"
 * - Gemini CLI: "● 1. Trust folder (x) / 2. Trust parent folder / 3. Don't trust"
 */
function managedWorktreeTrustResponse(tail: string, managedWorktree = false): CliPermissionKeys | null {
  if (!TRUST_RE.test(tail)) return null
  if (!managedWorktree && !MANAGED_WORKTREE_RE.test(tail)) return null
  const lines = tail.split('\n').map((line) => line.replace(/[│|]/g, ' ').trim()).filter(Boolean)
  if (lines.some((line) => /\[a\]\s*trust/i.test(line))) return 'a\r'
  const selected = lines.map((line) => SELECTED_RE.exec(line)?.[1]?.trim()).filter((text): text is string => Boolean(text)).pop()
  if (selected && ACCEPT_RE.test(selected) && !/parent/i.test(selected)) return '\r'
  if (selected && DECLINE_RE.test(selected)) {
    // Only step down when the option right below is the one that trusts this folder.
    const index = lines.findIndex((line) => SELECTED_RE.exec(line)?.[1]?.trim() === selected)
    const next = lines[index + 1]?.replace(/^\d+\.\s*/, '') ?? ''
    return ACCEPT_RE.test(next) && !/parent/i.test(next) ? TRUST_DOWN_THEN_ENTER : null
  }
  if (/yes,\s*i trust|trust this (?:folder|workspace|directory)/i.test(tail) && !selected) return '\r'
  return null
}

function confirmationKind(end: string): '\r' | 'y\r' | null {
  if (/\(y\/n\)|\[y\]es|\byes\/no\b/i.test(end)) return 'y\r'
  if (/(?:^|\n)\s*(?:❯|›|▶|▸|>)\s*.{0,48}\b(yes|allow|run|approve|accept|continue)\b/i.test(end)) return '\r'
  if (/\b(?:run|allow)\b[^.\n]{0,48}\?/i.test(end)) return '\r'
  return null
}

/**
 * Keystrokes for an approved CLI waiting on a prompt.
 * Confirmations and Enter pauses require at least one recognized command, all read-only.
 */
export function cliPermissionResponse(
  buffer: string,
  options?: { managedWorktree?: boolean }
): CliPermissionKeys | null {
  const tail = buffer.replace(ANSI_RE, '').replace(/\r/g, '').slice(-1200)
  if (!tail.trim()) return null
  if (TRUST_RE.test(tail)) return managedWorktreeTrustResponse(tail, options?.managedWorktree === true)
  const end = tail.slice(-400)
  const commands = commandLines(tail)
  const confirmation = confirmationKind(end)
  if (confirmation) {
    if (commands.length === 0 || commands.some((command) => !isReadOnlyCliCommand(command))) return null
    return confirmation
  }
  if (/press (?:enter|return)|hit enter|press any key|continue\?\s*$/i.test(end)) {
    if (commands.length === 0 || commands.some((command) => !isReadOnlyCliCommand(command))) return null
    return '\r'
  }
  return null
}
