import type { PtyKind, PtySessionStatus } from '@shared/contracts/pty'

const ANSI_RE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const SPINNER_RE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒]/
const BUSY_WORD_RE = /\b(thinking|generating|searching|analyzing|planning)\b|[✶✻]/i
const IDLE_PROMPT_RE = /(?:^|\n)\s*(?:>|❯|▶|▸|➤|➜)\s*$/
const IDLE_BOX_RE = /(?:ask|message|prompt)\s*(?:the\s+)?(?:agent|model|assistant)?\s*$/i

export function isCliKind(kind: PtyKind): boolean {
  return (
    kind === 'cursor' ||
    kind === 'claude' ||
    kind === 'gemini' ||
    kind === 'antigravity' ||
    kind === 'codex'
  )
}

export function mapProcessStatus(
  kind: PtyKind,
  status: PtySessionStatus
): PtySessionStatus {
  if (isCliKind(kind) && status === 'running') return 'waiting'
  return status
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}

export function inferCliActivity(buffer: string): 'waiting' | 'busy' | null {
  const tail = stripAnsi(buffer).replace(/\r/g, '').slice(-1200)
  if (!tail.trim()) return null
  if (SPINNER_RE.test(tail) || BUSY_WORD_RE.test(tail)) return 'busy'
  if (IDLE_PROMPT_RE.test(tail) || IDLE_BOX_RE.test(tail)) return 'waiting'
  return null
}

export function isPromptSubmit(data: string): boolean {
  return /[\r\n]/.test(data)
}

export function isInterrupt(data: string): boolean {
  return data === '\u0003'
}
