import {
  HOME_CHAT_IMAGE_TYPES,
  HOME_CHAT_MAX_IMAGES,
  HOME_CHAT_MAX_IMAGE_BYTES,
  HOME_CHAT_MAX_INPUT,
  type HomeChatImage,
  type HomeChatImageType,
  type HomeChatMessage
} from '@shared/contracts/dashboard'

/**
 * Pure helpers for the Home chat: reading `claude -p --output-format
 * stream-json` lines and keeping the stored conversation well formed.
 */

export type ChatStreamSignal =
  | { kind: 'delta'; text: string }
  | { kind: 'activity'; activity: string | null }
  | { kind: 'result'; text: string; isError: boolean }
  | null

const TOOL_ACTIVITY: Record<string, string> = {
  WebSearch: 'Searching the web',
  WebFetch: 'Reading a page'
}

export function readChatStreamLine(line: string): ChatStreamSignal {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
  if (payload.type === 'result') {
    const text = typeof payload.result === 'string' ? payload.result : ''
    return { kind: 'result', text, isError: payload.is_error === true || payload.subtype !== 'success' }
  }
  if (payload.type !== 'stream_event') return null
  const event = payload.event as Record<string, unknown> | undefined
  if (!event) return null
  if (event.type === 'content_block_delta') {
    const delta = event.delta as Record<string, unknown> | undefined
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') return { kind: 'delta', text: delta.text }
    if (delta?.type === 'thinking_delta') return { kind: 'activity', activity: 'Thinking' }
    return null
  }
  if (event.type === 'content_block_start') {
    const block = event.content_block as Record<string, unknown> | undefined
    if (block?.type === 'tool_use' || block?.type === 'server_tool_use') {
      const name = typeof block.name === 'string' ? block.name : ''
      return { kind: 'activity', activity: TOOL_ACTIVITY[name] ?? 'Working' }
    }
    if (block?.type === 'thinking') return { kind: 'activity', activity: 'Thinking' }
    if (block?.type === 'text') return { kind: 'activity', activity: null }
  }
  return null
}

/** Splits a growing stdout buffer into complete lines and the unfinished rest. */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts, rest }
}

export const HOME_CHAT_KEEP = 200

export function parseStoredChat(raw: string | null): { sessionId: string | null; messages: HomeChatMessage[] } {
  if (!raw) return { sessionId: null, messages: [] }
  try {
    const parsed = JSON.parse(raw) as { sessionId?: unknown; messages?: unknown }
    const sessionId = typeof parsed.sessionId === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.sessionId) ? parsed.sessionId : null
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.flatMap((entry): HomeChatMessage[] => {
          if (!entry || typeof entry !== 'object') return []
          const message = entry as Record<string, unknown>
          if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.text !== 'string') return []
          const images = Array.isArray(message.images) ? message.images.flatMap(storedImage) : []
          return [{
            id: typeof message.id === 'string' ? message.id : `${message.at ?? 0}-${message.role}`,
            role: message.role,
            text: message.text,
            at: typeof message.at === 'number' ? message.at : 0,
            ...(images.length > 0 ? { images } : {}),
            ...(message.incomplete === true ? { incomplete: true } : {})
          }]
        })
      : []
    return { sessionId, messages: messages.slice(-HOME_CHAT_KEEP) }
  } catch {
    return { sessionId: null, messages: [] }
  }
}

export function chatFailureMessage(detail: string): string {
  if (/not logged|log ?in|unauthori[sz]ed|authentication|invalid api key|oauth/i.test(detail)) {
    return 'Sign in to Claude Code to chat here.'
  }
  if (/rate limit|usage limit|limit reached|overloaded/i.test(detail)) {
    return 'Claude is at its usage limit right now. Try again later.'
  }
  return 'Claude could not answer. Try again.'
}

export const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const EXTENSION: Record<HomeChatImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

export function imageFileName(image: Pick<HomeChatImage, 'id' | 'mediaType'>): string {
  return `${image.id}.${EXTENSION[image.mediaType]}`
}

function isImageType(value: unknown): value is HomeChatImageType {
  return typeof value === 'string' && (HOME_CHAT_IMAGE_TYPES as readonly string[]).includes(value)
}

function storedImage(value: unknown): HomeChatImage[] {
  if (!value || typeof value !== 'object') return []
  const image = value as Record<string, unknown>
  if (typeof image.id !== 'string' || !IMAGE_ID.test(image.id) || !isImageType(image.mediaType)) return []
  return [{ id: image.id, name: typeof image.name === 'string' ? image.name.slice(0, 120) : 'image', mediaType: image.mediaType }]
}

export interface ValidChatInput {
  text: string
  images: Array<{ name: string; mediaType: HomeChatImageType; bytes: Buffer }>
}

/** Checks what the renderer sent: text length, image count, type and size. */
export function validateChatInput(value: unknown): { ok: true; input: ValidChatInput } | { ok: false; error: string } {
  const raw = typeof value === 'string' ? { text: value, images: [] } : value as { text?: unknown; images?: unknown } | null
  const text = typeof raw?.text === 'string' ? raw.text.trim().slice(0, HOME_CHAT_MAX_INPUT) : ''
  const list = Array.isArray(raw?.images) ? raw.images : []
  if (list.length > HOME_CHAT_MAX_IMAGES) return { ok: false, error: `Attach at most ${HOME_CHAT_MAX_IMAGES} images` }
  const images: ValidChatInput['images'] = []
  for (const entry of list) {
    const image = entry as { name?: unknown; mediaType?: unknown; data?: unknown } | null
    if (!image || !isImageType(image.mediaType) || typeof image.data !== 'string') return { ok: false, error: 'Only PNG, JPEG, GIF and WebP images can be sent' }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return { ok: false, error: 'An image could not be read' }
    const bytes = Buffer.from(image.data, 'base64')
    if (bytes.length === 0) return { ok: false, error: 'An image could not be read' }
    if (bytes.length > HOME_CHAT_MAX_IMAGE_BYTES) return { ok: false, error: 'An image is larger than 5 MB' }
    images.push({ name: typeof image.name === 'string' && image.name.trim() ? image.name.trim().slice(0, 120) : 'image', mediaType: image.mediaType, bytes })
  }
  if (!text && images.length === 0) return { ok: false, error: 'Type a question first' }
  return { ok: true, input: { text, images } }
}

/** One stream-json user line: images first, then the question. */
export function chatInputLine(text: string, images: Array<{ mediaType: HomeChatImageType; bytes: Buffer }>): string {
  const content: Array<Record<string, unknown>> = images.map((image) => ({
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType, data: image.bytes.toString('base64') }
  }))
  content.push({ type: 'text', text: text || 'Look at the attached image.' })
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`
}
