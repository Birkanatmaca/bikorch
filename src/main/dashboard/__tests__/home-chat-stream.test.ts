import { describe, expect, it } from 'vitest'
import { chatFailureMessage, parseStoredChat, readChatStreamLine, splitLines } from '../home-chat-stream'

const line = (value: unknown): string => JSON.stringify(value)

describe('home chat stream', () => {
  it('reads text deltas, tool activity and the result', () => {
    expect(readChatStreamLine(line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } })))
      .toEqual({ kind: 'delta', text: 'Hi' })
    expect(readChatStreamLine(line({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'server_tool_use', name: 'WebSearch' } } })))
      .toEqual({ kind: 'activity', activity: 'Searching the web' })
    expect(readChatStreamLine(line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '…' } } })))
      .toEqual({ kind: 'activity', activity: 'Thinking' })
    expect(readChatStreamLine(line({ type: 'result', subtype: 'success', is_error: false, result: 'Done' })))
      .toEqual({ kind: 'result', text: 'Done', isError: false })
    expect(readChatStreamLine(line({ type: 'result', subtype: 'error_during_execution', result: '' }))?.kind).toBe('result')
    expect(readChatStreamLine(line({ type: 'system', subtype: 'init' }))).toBeNull()
    expect(readChatStreamLine('not json')).toBeNull()
  })

  it('keeps an unfinished line for the next chunk', () => {
    expect(splitLines('{"a":1}\n{"b"')).toEqual({ lines: ['{"a":1}'], rest: '{"b"' })
  })

  it('restores a stored conversation and drops malformed entries', () => {
    const stored = parseStoredChat(JSON.stringify({
      sessionId: '0f8b1c1e-1111-4222-8333-444455556666',
      messages: [
        { id: 'a', role: 'user', text: 'Hi', at: 1 },
        { id: 'b', role: 'assistant', text: 'Hello', at: 2, incomplete: true },
        { role: 'system', text: 'nope' },
        { role: 'user' }
      ]
    }))
    expect(stored.sessionId).toBe('0f8b1c1e-1111-4222-8333-444455556666')
    expect(stored.messages).toEqual([
      { id: 'a', role: 'user', text: 'Hi', at: 1 },
      { id: 'b', role: 'assistant', text: 'Hello', at: 2, incomplete: true }
    ])
    expect(parseStoredChat(JSON.stringify({ sessionId: '../etc', messages: [] })).sessionId).toBeNull()
    expect(parseStoredChat('{bad')).toEqual({ sessionId: null, messages: [] })
  })

  it('explains sign-in and limit failures plainly', () => {
    expect(chatFailureMessage('Error: Not logged in · Please run /login')).toMatch(/Sign in/)
    expect(chatFailureMessage('Claude usage limit reached')).toMatch(/usage limit/)
    expect(chatFailureMessage('boom')).toMatch(/could not answer/)
  })
})

describe('home chat images', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')

  it('accepts text with images and builds one stream-json line', async () => {
    const { validateChatInput, chatInputLine } = await import('../home-chat-stream')
    const result = validateChatInput({ text: ' Why? ', images: [{ name: 'shot.png', mediaType: 'image/png', data: png }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.text).toBe('Why?')
    const line = JSON.parse(chatInputLine(result.input.text, result.input.images))
    expect(line.message.content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } })
    expect(line.message.content[1]).toEqual({ type: 'text', text: 'Why?' })
  })

  it('rejects unsupported, oversized, too many or empty input', async () => {
    const { validateChatInput } = await import('../home-chat-stream')
    expect(validateChatInput({ text: 'x', images: [{ name: 'a.svg', mediaType: 'image/svg+xml', data: png }] }).ok).toBe(false)
    expect(validateChatInput({ text: 'x', images: [{ name: 'a', mediaType: 'image/png', data: 'not base64!' }] }).ok).toBe(false)
    expect(validateChatInput({ text: 'x', images: Array.from({ length: 5 }, () => ({ name: 'a', mediaType: 'image/png', data: png })) }).ok).toBe(false)
    const big = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')
    expect(validateChatInput({ text: 'x', images: [{ name: 'a', mediaType: 'image/png', data: big }] }).ok).toBe(false)
    expect(validateChatInput({ text: '  ', images: [] }).ok).toBe(false)
    expect(validateChatInput({ text: '', images: [{ name: 'a', mediaType: 'image/png', data: png }] }).ok).toBe(true)
  })
})
