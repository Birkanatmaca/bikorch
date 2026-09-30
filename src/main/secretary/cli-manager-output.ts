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

/** Turns CLI stdout into the same JSON string the API provider returns. */
export function normalizeManagerCliOutput(stdout: string, format: SecretaryResponseFormat): string {
  const cleaned = stripAnsi(stdout).trim()
  if (!cleaned) throw new Error('The Manager CLI returned no structured result.')
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
