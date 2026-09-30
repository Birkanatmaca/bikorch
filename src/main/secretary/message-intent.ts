import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import type { CliUsageKind } from '@shared/contracts/usage'

const CLI_WORK_RE =
  /(?:cli\s*aç|open\s+(?:a\s+)?(?:cursor\s+|claude\s+|gemini\s+|codex\s+|antigravity\s+)?cli|promptu?\s+gönder|send\s+(?:this\s+)?to\s+(?:the\s+)?cli|\b(?:analiz(?:\s+et)?|implement|implemente|düzelt|incele|review|refactor|çalıştır|run tests?|fix|build)\b)/i

const PANEL_OPEN_RE = /\b(?:aç|açar|açmak|açıyor|açalım|open|başlat|start|launch)\b/i
const PANEL_WORK_RE = /\b(?:analiz|analyze|implement|düzelt|incele|review|refactor|prompt|gönder|send|fix|build|yaz|write|edit|çalıştır|run)\b/i

function panelCount(message: string): number {
  const digit = message.match(/\b([1-3])\b/)
  if (digit) return Number(digit[1])
  if (/\b(?:üç|three)\b/i.test(message)) return 3
  if (/\b(?:iki|two)\b/i.test(message)) return 2
  return 1
}

/** Panels to open immediately when the user only asked to open CLI panels. */
export function cliPanelsToOpen(message: string): CliUsageKind[] {
  const text = message.trim()
  if (!PANEL_OPEN_RE.test(text) || PANEL_WORK_RE.test(text)) return []
  const kinds = [...text.matchAll(/\b(antigravity|cursor|claude|gemini|codex)\b/gi)]
    .map((match) => match[1].toLowerCase() as CliUsageKind)
    .filter((kind, index, all) => AI_ACCOUNT_KINDS.includes(kind) && all.indexOf(kind) === index)
  if (kinds.length === 0) return []
  const count = panelCount(text)
  if (kinds.length > 1) return kinds.slice(0, 3)
  return Array.from({ length: count }, () => kinds[0])
}

export function messageRequestsCliWork(message: string): boolean {
  return CLI_WORK_RE.test(message.trim())
}
