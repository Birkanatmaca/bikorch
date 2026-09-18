const PASTE_START = '\u001b[200~'
const PASTE_END = '\u001b[201~'

/** Wrap text in the terminal's bracketed-paste protocol. */
export function formatCliPaste(prompt: string): string {
  return `${PASTE_START}${prompt}${PASTE_END}`
}
