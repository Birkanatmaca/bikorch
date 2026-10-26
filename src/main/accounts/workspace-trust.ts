import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import type { CliUsageKind } from '@shared/contracts/usage'

/**
 * The Manager runs every task in a fresh Git worktree, and CLIs ask "do you
 * trust this folder?" for every new folder. Nobody is watching that terminal, so
 * the run stalls. Bikorch created these folders itself, so it records them as
 * trusted in the CLI's own settings before launching, scoped to Bikorch's
 * agent-worktrees folder and nothing else. Verified against Claude Code 2.1,
 * Codex 0.150 and Gemini CLI 0.31; if a release changes the format, the prompt
 * answering in the result collector remains the fallback.
 */

type JsonRecord = Record<string, unknown>

function readJson(path: string): JsonRecord | null | 'unreadable' {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonRecord) : 'unreadable'
  } catch {
    // Never overwrite a file we could not parse: it may be mid-write by the CLI.
    return 'unreadable'
  }
}

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.bikorch-${process.pid}.tmp`
  writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

export function isInside(parent: string, child: string): boolean {
  const base = resolve(parent)
  const target = resolve(child)
  return target === base || target.startsWith(base + sep)
}

/**
 * The main repository of a linked worktree, read from its `.git` file
 * ("gitdir: /repo/.git/worktrees/<name>"), without starting a git process.
 */
export function mainRepositoryOf(worktree: string): string | null {
  try {
    const pointer = readFileSync(join(worktree, '.git'), 'utf8')
    const gitDir = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim()
    const marker = gitDir ? gitDir.replace(/\\/g, '/').lastIndexOf('/.git/worktrees/') : -1
    return gitDir && marker > 0 ? resolve(gitDir.slice(0, marker)) : null
  } catch {
    return null
  }
}

/**
 * Claude Code checks trust for a parent folder, but inside a git worktree it
 * checks the main repository instead (verified with Claude Code 2.1). Mark both.
 * The repository is the project the user opened and approved Manager work in.
 */
function trustForClaude(configDir: string, folders: string[]): boolean {
  const path = join(configDir, '.claude.json')
  const config = readJson(path)
  if (config === 'unreadable') return false
  const current = config ?? {}
  const projects = { ...((current.projects && typeof current.projects === 'object' ? current.projects : {}) as JsonRecord) }
  let changed = false
  for (const folder of folders) {
    const entry = (projects[folder] && typeof projects[folder] === 'object' ? projects[folder] : {}) as JsonRecord
    if (entry.hasTrustDialogAccepted === true) continue
    projects[folder] = { ...entry, hasTrustDialogAccepted: true }
    changed = true
  }
  if (changed) writeAtomic(path, JSON.stringify({ ...current, projects }, null, 2))
  return true
}

/** Gemini CLI treats TRUST_FOLDER as covering subfolders as well. */
function trustForGemini(cliHome: string, agentRoot: string): boolean {
  const path = join(cliHome, '.gemini', 'trustedFolders.json')
  const folders = readJson(path)
  if (folders === 'unreadable') return false
  const current = folders ?? {}
  if (current[agentRoot] === 'TRUST_FOLDER') return true
  writeAtomic(path, JSON.stringify({ ...current, [agentRoot]: 'TRUST_FOLDER' }, null, 2))
  return true
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Codex keys trust by exact folder, so each worktree gets its own table. */
function trustForCodex(codexHome: string, worktree: string): boolean {
  const path = join(codexHome, 'config.toml')
  const config = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const header = `[projects.${tomlString(worktree)}]`
  if (config.includes(header)) return true
  const separator = config && !config.endsWith('\n') ? '\n' : ''
  writeAtomic(path, `${config}${separator}\n${header}\ntrust_level = "trusted"\n`)
  return true
}

export interface TrustRequest {
  kind: CliUsageKind
  /** Folder the CLI starts in. */
  cwd: string
  /** Bikorch's agent-worktrees folder; nothing outside it is ever trusted. */
  agentRoot: string
  /** CLAUDE_CONFIG_DIR / GEMINI_CLI_HOME / CODEX_HOME of a Bikorch account, if any. */
  profileEnv: Record<string, string>
}

/** Returns true when the CLI should start without a trust question. */
export function trustManagedWorktree(request: TrustRequest): boolean {
  if (!isInside(request.agentRoot, request.cwd)) return false
  const agentRoot = resolve(request.agentRoot)
  // Only Bikorch's own account profiles are edited. The user's global files
  // (~/.claude.json and friends) are rewritten by running CLIs, so a concurrent
  // write could lose their changes; those launches rely on the prompt fallback.
  try {
    if (request.kind === 'claude' && request.profileEnv.CLAUDE_CONFIG_DIR) {
      const repository = mainRepositoryOf(request.cwd)
      return trustForClaude(request.profileEnv.CLAUDE_CONFIG_DIR, repository ? [agentRoot, repository] : [agentRoot])
    }
    if (request.kind === 'gemini' && request.profileEnv.GEMINI_CLI_HOME) {
      return trustForGemini(request.profileEnv.GEMINI_CLI_HOME, agentRoot)
    }
    if (request.kind === 'codex' && request.profileEnv.CODEX_HOME) {
      return trustForCodex(request.profileEnv.CODEX_HOME, resolve(request.cwd))
    }
  } catch (error) {
    console.warn('[trust] Could not pre-trust the agent worktree:', error instanceof Error ? error.message : error)
  }
  return false
}
