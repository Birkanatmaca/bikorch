const PASTE_START = '\u001b[200~'
const PASTE_END = '\u001b[201~'
const SUBMIT_DELAY_MS = 120

export function formatCliPaste(prompt: string): string {
  return `${PASTE_START}${prompt}${PASTE_END}`
}

export async function submitCliPrompt(sessionId: string, prompt: string): Promise<void> {
  const text = prompt.trim()
  if (!text || !window.api.pty?.write) return
  await window.api.pty.write({ sessionId, data: formatCliPaste(text) })
  await new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS))
  await window.api.pty.write({ sessionId, data: '\r' })
}
