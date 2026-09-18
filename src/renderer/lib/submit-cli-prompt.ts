import { formatCliPaste } from '@shared/cli-prompt'

export { formatCliPaste } from '@shared/cli-prompt'

const SUBMIT_DELAY_MS = 120

export async function submitCliPrompt(sessionId: string, prompt: string): Promise<void> {
  const text = prompt.trim()
  if (!text || !window.api.pty?.write) return
  await window.api.pty.write({ sessionId, data: formatCliPaste(text) })
  await new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS))
  await window.api.pty.write({ sessionId, data: '\r' })
}
