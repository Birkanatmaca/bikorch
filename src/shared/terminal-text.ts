const ANSI_RE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}

/**
 * Antigravity paints the signed-in email in a 256-color code (`38;5;131m`).
 * A text grab can keep the color tail glued to the address.
 */
export function cleanCliLabel(value: string): string {
  const stripped = stripAnsi(value).replace(/\r/g, '').trim()
  if (!stripped.includes('@')) return stripped
  return stripped.replace(/^(?:\d{1,3}m)+/i, '')
}
