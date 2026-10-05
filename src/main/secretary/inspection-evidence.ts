import { lstat, readFile, realpath } from 'fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'path'
import { redactSecrets } from '../developer-intelligence/redaction'

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.py', '.go', '.rs', '.java',
  '.kt', '.swift', '.cs', '.rb', '.php', '.vue', '.svelte', '.html', '.css', '.scss',
  '.sql', '.yaml', '.yml', '.toml', '.sh'
])
const CONFIG_FILES = new Set(['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Dockerfile'])
const MAX_SOURCE_FILES = 6
const MAX_SOURCE_CHARS = 2_200
const MAX_SOURCE_BYTES = 256 * 1024

export interface ManagerSourceExcerpt {
  path: string
  startLine: number
  endLine: number
  content: string
  reason: 'changed' | 'requested' | 'configuration' | 'project-entry'
  truncated: boolean
}

/** Terminal escape sequences must not hide credentials or become model instructions. */
export function cleanManagerTerminalOutput(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

export function sanitizeInspectionText(value: string, root: string, maxLength: number, preserveWhitespace = false): string {
  // Minified source and corrupted terminal lines can contain enormous tokens.
  // Omit those before credential matching so a bounded inspection stays cheap.
  const redacted = redactSecrets(value.replace(/\S{2_048,}/g, '[TRUNCATED LONG VALUE]')).text
  const relativeText = root ? redacted.split(root).join('[project]') : redacted
  const safe = relativeText
    .replace(/\/(?:Users|home)\/[^\s/]+/g, '[home]')
    .replace(/[A-Za-z]:\\Users\\[^\s\\]+/g, '[home]')
  return (preserveWhitespace ? safe : safe.trim()).slice(0, maxLength)
}

/** Captures failure lines with context; an error-shaped line is evidence, not a proven diagnosis. */
export function managerTerminalFailureExcerpt(value: string, root: string, failed = false): string | null {
  const lines = cleanManagerTerminalOutput(value).slice(-8_000).split('\n')
  const signals = lines.flatMap((line, index) => {
    const passing = /\b(?:no errors|0 errors|0 failed|failures?:\s*0|errors?:\s*(?:0|none))\b/i.test(line)
    const positiveFailure = /\b[1-9]\d*\s+(?:tests?\s+)?(?:failed|errors?|failures?)\b|\b(?:[A-Z][A-Za-z]*Error|Error):|npm ERR!|^\s*FAIL\s+/.test(line)
    if (passing && !positiveFailure) return []
    return /\b(?:error|exception|fatal|failed|failure|panic|traceback|ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT|TS\d{4})\b|\b[A-Z][A-Za-z]*(?:Error|Exception):|npm ERR!|^\s*FAIL\s+|segmentation fault|unhandled rejection|cannot find|module not found|command not found|permission denied/i.test(line)
      ? [index]
      : []
  }).slice(-3)
  if (signals.length === 0) {
    return failed ? sanitizeInspectionText(lines.slice(-14).join('\n'), root, 2_200) || null : null
  }
  const selected = new Set<number>()
  for (const index of signals) {
    for (let line = Math.max(0, index - 2); line <= Math.min(lines.length - 1, index + 3); line += 1) selected.add(line)
  }
  return sanitizeInspectionText([...selected].sort((a, b) => a - b).map((index) => lines[index]).join('\n'), root, 2_200) || null
}

function isSourcePath(path: string): boolean {
  const name = basename(path).toLowerCase()
  if (path.split('/').some((part) => /^\.env(?:\.|$)|^\.(?:ssh|aws|git)$|^(?:credentials?|secrets?)(?:[._-]|$)/i.test(part))) return false
  if (/lock(?:\.json|\.ya?ml|\.toml|b)?$|\.min\.|\.map$|\.d\.ts$/.test(name)) return false
  return CONFIG_FILES.has(basename(path)) || SOURCE_EXTENSIONS.has(extname(path).toLowerCase())
}

/** Uses only listed project files, never follows symlinks or reads arbitrary model-supplied paths. */
export async function readManagerSourceExcerpts(
  root: string,
  paths: string[],
  changedPaths: string[],
  focus: string
): Promise<ManagerSourceExcerpt[]> {
  const canonicalRoot = await realpath(root).catch(() => null)
  if (!canonicalRoot) return []
  const changed = new Set(changedPaths)
  const lowerFocus = focus.toLowerCase().slice(0, 12_000)
  const tokens = new Set(lowerFocus.match(/[\p{L}\p{N}_-]{4,}/gu) ?? [])
  const candidates = paths.filter(isSourcePath).map((path) => {
    const lowerPath = path.toLowerCase()
    const name = basename(path, extname(path)).toLowerCase()
    const requested = lowerFocus.includes(lowerPath) || (name.length >= 4 && tokens.has(name))
    const configuration = CONFIG_FILES.has(basename(path)) || /(?:vite|tsconfig|eslint|vitest|webpack|next)\./.test(basename(path))
    const entry = /(?:^|\/)(?:main|index|app|server|routes?)\.[^/]+$/i.test(path)
    return {
      path,
      score: (requested ? 100 : 0) + (changed.has(path) ? 60 : 0) + (configuration ? 30 : 0) + (entry ? 20 : 0),
      reason: requested ? 'requested' as const : changed.has(path) ? 'changed' as const : configuration ? 'configuration' as const : 'project-entry' as const
    }
  }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))

  const excerpts: ManagerSourceExcerpt[] = []
  for (const candidate of candidates) {
    if (excerpts.length >= MAX_SOURCE_FILES) break
    const path = join(canonicalRoot, candidate.path)
    if (isAbsolute(candidate.path) || relative(canonicalRoot, path).startsWith('..')) continue
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SOURCE_BYTES) continue
      if (await realpath(path) !== path) continue
      const raw = await readFile(path, 'utf8')
      if (raw.includes('\u0000')) continue
      const lines = raw.split('\n')
      const escaped = candidate.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const location = focus.match(new RegExp(`${escaped}:(\\d+)`))
      const focusLine = location ? Number(location[1]) : 1
      const startIndex = Math.max(0, Math.min(lines.length - 1, focusLine - 1) - (location ? 8 : 0))
      const selected: string[] = []
      let length = 0
      for (const line of lines.slice(startIndex, startIndex + 65)) {
        if (length >= MAX_SOURCE_CHARS) break
        selected.push(line)
        length += line.length + 1
      }
      const content = sanitizeInspectionText(sanitizeInspectionText(selected.join('\n'), canonicalRoot, MAX_SOURCE_CHARS, true), root, MAX_SOURCE_CHARS, true)
      if (!content.trim()) continue
      excerpts.push({
        path: candidate.path,
        startLine: startIndex + 1,
        endLine: startIndex + selected.length,
        content,
        reason: candidate.reason,
        truncated: startIndex > 0 || selected.length < lines.length || length > MAX_SOURCE_CHARS
      })
    } catch {
      // A disappearing or unreadable file does not block project inspection.
    }
  }
  return excerpts
}
