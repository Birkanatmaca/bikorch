import { describe, expect, it } from 'vitest'
import { extractResponseText, parseJsonObject, readSecretaryReply } from '../response-text'

describe('extractResponseText', () => {
  it('prefers the SDK convenience field when present', () => {
    expect(extractResponseText({ output_text: '  hello  ' })).toBe('hello')
  })

  it('reads REST output_text parts from the output array', () => {
    expect(
      extractResponseText({
        output: [
          { type: 'reasoning', content: [] },
          {
            type: 'message',
            content: [
              { type: 'output_text', text: '{"reply":"ok"}' }
            ]
          }
        ]
      })
    ).toBe('{"reply":"ok"}')
  })

  it('returns empty when the payload has no text', () => {
    expect(extractResponseText({ output: [{ type: 'message', content: [] }] })).toBe('')
  })
})

describe('readSecretaryReply', () => {
  it('pulls reply and optional plan from a JSON object', () => {
    const parsed = readSecretaryReply(JSON.stringify({
      reply: 'I can help.',
      plan: { overview: 'Do the work', assignments: [] }
    }))
    expect(parsed.reply).toBe('I can help.')
    expect(parsed.planRaw).toEqual({ overview: 'Do the work', assignments: [] })
  })

  it('treats a planning-only payload as a reply via overview', () => {
    const parsed = readSecretaryReply(JSON.stringify({
      overview: 'Split the work',
      assignments: [{ title: 'Fix login' }]
    }))
    expect(parsed.reply).toBe('Split the work')
    expect(parsed.planRaw).toMatchObject({ overview: 'Split the work' })
  })

  it('falls back to the raw text when JSON is absent', () => {
    expect(readSecretaryReply('Just chatting.')).toEqual({
      reply: 'Just chatting.',
      planRaw: null,
      openKindsRaw: null
    })
  })

  it('keeps requested CLI kinds to open', () => {
    const parsed = readSecretaryReply(JSON.stringify({
      reply: 'Opening Cursor CLI.',
      openKinds: ['cursor'],
      plan: { overview: 'Analyze helper-new', assignments: [] }
    }))
    expect(parsed.openKindsRaw).toEqual(['cursor'])
  })

  it('parses fenced JSON', () => {
    expect(parseJsonObject('```json\n{"reply":"hi"}\n```')).toEqual({ reply: 'hi' })
  })
})
