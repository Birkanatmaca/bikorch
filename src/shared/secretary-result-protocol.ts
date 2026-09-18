export type SecretaryCliOutcome = 'completed' | 'needs-user' | 'failed'

export interface SecretaryCliStructuredResult {
  outcome: SecretaryCliOutcome
  summary: string
  changedFiles: string[]
  needsUser: string | null
}

const OPEN_TAG = '<BIKORCH_RESULT>'
const CLOSE_TAG = '</BIKORCH_RESULT>'

function safeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function safeChangedFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const path = safeText(item, 500).replace(/\\/g, '/')
    return path && !path.startsWith('/') && !path.startsWith('../') && !path.includes('/../') ? [path] : []
  }).slice(0, 30)
}

/** Adds a machine-readable completion request without changing the planned task. */
export function wrapSecretaryCliInstruction(instruction: string): string {
  return `${instruction.trim()}\n\nWhen the task is finished, print one final <BIKORCH_RESULT> JSON tag. Its JSON fields must be: status (completed, needs-user, or failed), summary (short), changedFiles (relative paths array), and needsUser (string or null). Do not include secrets in that result.`
}

/** Extracts the last valid final marker from untrusted terminal output. */
export function readSecretaryCliResult(output: string): SecretaryCliStructuredResult | null {
  let start = 0
  let candidate: SecretaryCliStructuredResult | null = null
  while (start < output.length) {
    const open = output.indexOf(OPEN_TAG, start)
    if (open < 0) break
    const close = output.indexOf(CLOSE_TAG, open + OPEN_TAG.length)
    if (close < 0) break
    start = close + CLOSE_TAG.length
    const raw = output.slice(open + OPEN_TAG.length, close).trim()
    try {
      const parsed = JSON.parse(raw) as {
        status?: unknown
        summary?: unknown
        changedFiles?: unknown
        needsUser?: unknown
      }
      if (parsed.status !== 'completed' && parsed.status !== 'needs-user' && parsed.status !== 'failed') continue
      const summary = safeText(parsed.summary, 2_000)
      if (!summary) continue
      candidate = {
        outcome: parsed.status,
        summary,
        changedFiles: safeChangedFiles(parsed.changedFiles),
        needsUser: typeof parsed.needsUser === 'string' ? safeText(parsed.needsUser, 1_000) || null : null
      }
    } catch {
      // A CLI may print malformed look-alike text; keep scanning.
    }
  }
  return candidate
}
