const CLI_WORK_RE =
  /(?:cli\s*aç|open\s+(?:a\s+)?(?:cursor\s+|claude\s+|gemini\s+|codex\s+|antigravity\s+)?cli|promptu?\s+gönder|send\s+(?:this\s+)?to\s+(?:the\s+)?cli|\b(?:analiz(?:\s+et)?|implement|implemente|düzelt|incele|review|refactor|çalıştır|run tests?|fix|build)\b)/i

export function messageRequestsCliWork(message: string): boolean {
  return CLI_WORK_RE.test(message.trim())
}
