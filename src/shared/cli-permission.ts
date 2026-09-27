const ANSI_RE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const TRUST_RE = /workspace trust required|trust this workspace|do you trust the (?:files|contents) of this directory/i
const DESTRUCTIVE_RE = /\b(delete all|rm -rf|git push|git reset --hard|drop database|force push)\b/i

/** Keystrokes for an approved CLI that is waiting on Allow, Run, or Enter. */
export function cliPermissionResponse(buffer: string): '\r' | 'y\r' | null {
  const tail = buffer.replace(ANSI_RE, '').replace(/\r/g, '').slice(-600)
  if (!tail.trim() || TRUST_RE.test(tail) || DESTRUCTIVE_RE.test(tail)) return null
  const end = tail.slice(-400)
  if (/press (?:enter|return)|hit enter|press any key|continue\?\s*$/i.test(end)) return '\r'
  if (/\(y\/n\)|\[y\]es|\byes\/no\b/i.test(end)) return 'y\r'
  if (/(?:^|\n)\s*(?:❯|›|▶|▸|>)\s*.{0,48}\b(yes|allow|run|approve|accept|continue)\b/i.test(end)) return '\r'
  if (/\b(?:run|allow)\b[^.\n]{0,48}\?/i.test(end)) return '\r'
  return null
}
