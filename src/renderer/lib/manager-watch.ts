import type { PanelDefinition } from '@shared/types'
import type { PtySessionStatus } from '@shared/contracts/pty'
import { stripAnsi } from '@shared/terminal-text'
import { isPtyPanelType } from './project-activity'

export interface ManagerFailureSignal {
  key: string
  title: string
}

function isFailureLine(line: string): boolean {
  // Passing test names often mention the error class they exercise.
  if (/^\s*(?:[✓✔√]|PASS\b)/i.test(line)) return false
  const diagnostic = line.replace(/\b(?:no errors?|0\s+(?:errors?|failed)|(?:errors?|failures?)\s*:\s*(?:0|none))\b/gi, '')
  return /\b(?:[\w.]+(?:Error|Exception)|error|exception|fatal|panic)\s*[:\[]/i.test(diagnostic)
    || /^\s*Traceback \(most recent call last\):/i.test(diagnostic)
    || /^\s*(?:FAIL|FAILED)\b/.test(diagnostic)
    || /^\s*npm\s+(?:ERR!|error\b)/i.test(diagnostic)
    || /\bTS\d{4}\s*:/i.test(diagnostic)
    || /\b(?:ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT)\s*:/i.test(diagnostic)
    || /\b(?:connect|listen|open|spawn|stat|read|write|unlink|mkdir|request)\s+(?:ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT)\b/i.test(diagnostic)
    || /\b(?:build|compilation|tests?)\s+failed\b/i.test(diagnostic)
    || /\b[1-9]\d*\s+(?:tests?\s+)?(?:failed|failures?)\b/i.test(diagnostic)
    || /\b(?:command not found|cannot find module|module not found|segmentation fault|unhandled rejection)\b/i.test(diagnostic)
}

function isRecoveryLine(line: string): boolean {
  return /^\s*(?:Tests?|Test suites?)\s*:?\s+[1-9]\d*\s+passed\b/i.test(line)
    || /\ball tests passed\b|\b(?:build|compilation) (?:completed successfully|succeeded|successful)\b/i.test(line)
}

/** Only strong failure signals trigger an automatic model request. Raw output stays in main. */
export function managerFailureSignals(
  panels: PanelDefinition[],
  sessions: Record<string, PtySessionStatus>,
  errors: Record<string, string | undefined>,
  tails: Record<string, string>
): ManagerFailureSignal[] {
  return panels.flatMap((panel) => {
    if (!isPtyPanelType(panel.type)) return []
    const status = sessions[panel.id]
    if (!status || status === 'starting' || status === 'busy') return []
    const lines = stripAnsi(tails[panel.id] ?? '').replace(/\r/g, '').slice(-4000).split('\n')
    let failures: string[] = []
    for (const line of lines) {
      if (isFailureLine(line)) failures.push(line)
      // A later successful run supersedes diagnostics still visible in scrollback.
      else if (isRecoveryLine(line)) failures = []
    }
    failures = failures.slice(-3)
    const error = status === 'error' ? errors[panel.id] ?? 'Terminal session failed' : ''
    if (!error && failures.length === 0) return []
    return [{ key: `${panel.id}:${fingerprint([error, ...failures].join('\n'))}`, title: panel.title }]
  })
}

export function fingerprint(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  }
  return (hash >>> 0).toString(36)
}
