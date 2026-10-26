import type { SecretaryResponseFormat } from './response-schema'
import { parseJsonObject } from './response-text'

function requiredKeys(format: SecretaryResponseFormat): string[] {
  const required = format.schema.required
  return Array.isArray(required) ? required.filter((key): key is string => typeof key === 'string') : []
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function textFromCliPayload(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const text = textFromCliPayload(value[index])
      if (text) return text
    }
    return null
  }
  const body = value as Record<string, unknown>
  for (const key of ['result', 'text', 'message', 'content', 'output']) {
    const nested = textFromCliPayload(body[key])
    if (nested) return nested
  }
  return null
}

function hasRequiredKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => key in value)
}

function chatFallback(reply: string): Record<string, unknown> {
  return {
    reply,
    openKinds: [],
    plan: null,
    contextSummary: '',
    skills: [],
    actions: []
  }
}

/**
 * `codex exec --json` prints one JSON event per line. The answer is the text of
 * the last completed agent message (`item.completed` / `agent_message`; older
 * releases used `{ msg: { type: 'agent_message', message } }`). Returns null when
 * the output is not an event stream.
 */
const CODEX_EVENT_TYPES = new Set([
  'thread.started',
  'turn.started',
  'turn.completed',
  'turn.failed',
  'agent_message',
  'task_started',
  'task_complete',
  'error'
])

export function readCodexEventStream(output: string): string | null {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('{'))
  if (lines.length === 0) return null
  let sawEvent = false
  let answer: string | null = null
  let failure: string | null = null
  for (const line of lines) {
    let event: Record<string, unknown>
    try {
      const parsed = JSON.parse(line) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      event = parsed as Record<string, unknown>
    } catch {
      continue
    }
    const msg = event.msg && typeof event.msg === 'object' ? (event.msg as Record<string, unknown>) : null
    const type = typeof event.type === 'string' ? event.type : typeof msg?.type === 'string' ? msg.type : null
    // Claude and Cursor also print `{"type":"result",...}`; only Codex's own event names count.
    if (!type || !(CODEX_EVENT_TYPES.has(type) || type.startsWith('item.'))) continue
    sawEvent = true
    const item = event.item && typeof event.item === 'object' ? (event.item as Record<string, unknown>) : null
    if (type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
      answer = item.text.trim()
    } else if (type === 'agent_message' && typeof msg?.message === 'string' && msg.message.trim()) {
      answer = msg.message.trim()
    } else if (type === 'turn.failed' || type === 'error') {
      const nested = event.error && typeof event.error === 'object' ? (event.error as Record<string, unknown>).message : undefined
      const message = typeof event.message === 'string' ? event.message : typeof nested === 'string' ? nested : null
      if (message) failure = message
    }
  }
  if (!sawEvent) return null
  if (answer) return answer
  if (failure && /401|unauthori[sz]ed|authentication|log ?in/i.test(failure)) throw new Error('Authentication required')
  throw new Error(failure ? `The Manager CLI failed: ${failure.slice(0, 200)}` : 'The Manager CLI returned no structured result.')
}

/** Turns CLI stdout into the same JSON string the API provider returns. */
export function normalizeManagerCliOutput(stdout: string, format: SecretaryResponseFormat): string {
  const raw = stripAnsi(stdout).trim()
  if (!raw) throw new Error('The Manager CLI returned no structured result.')
  const cleaned = readCodexEventStream(raw) ?? raw
  const keys = requiredKeys(format)
  const parsed = parseJsonObject(cleaned)
  const candidates: unknown[] = [parsed]
  const unwrapped = textFromCliPayload(parsed)
  if (unwrapped && unwrapped !== cleaned) candidates.push(parseJsonObject(unwrapped), unwrapped)

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const body = candidate as Record<string, unknown>
      if (hasRequiredKeys(body, keys)) return JSON.stringify(body)
    }
  }

  if (keys.includes('reply') && !keys.includes('overview')) {
    const reply = unwrapped || (typeof parsed === 'string' ? parsed : cleaned)
    const structured = parseJsonObject(reply)
    if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
      const body = structured as Record<string, unknown>
      if (typeof body.reply === 'string' && body.reply.trim()) {
        return JSON.stringify({ ...chatFallback(body.reply.trim()), ...body, reply: body.reply.trim() })
      }
    }
    const prose = reply.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
    if (!prose) throw new Error('The Manager CLI returned no structured result.')
    return JSON.stringify(chatFallback(prose))
  }

  throw new Error('The Manager CLI returned no structured result.')
}
