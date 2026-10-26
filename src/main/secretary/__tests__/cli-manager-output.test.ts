import { describe, expect, it } from 'vitest'
import { normalizeManagerCliOutput, readCodexEventStream } from '../cli-manager-output'

const CHAT_FORMAT = {
  name: 'chat',
  schema: { type: 'object', required: ['reply', 'openKinds', 'plan'], properties: {} }
} as never

const reply = JSON.stringify({ reply: 'Hello from Codex', openKinds: [], plan: null })

describe('Codex Manager output', () => {
  it('reads the last agent message from the JSON event stream', () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"i0","type":"reasoning","text":"thinking"}}',
      `{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":${JSON.stringify(reply)}}}`,
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'
    ].join('\n')
    expect(JSON.parse(normalizeManagerCliOutput(stdout, CHAT_FORMAT)).reply).toBe('Hello from Codex')
  })

  it('reads the older msg/agent_message shape', () => {
    expect(readCodexEventStream(`{"msg":{"type":"agent_message","message":"hi"}}`)).toBe('hi')
  })

  it('reports a sign-in failure instead of showing raw events', () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"error","message":"unexpected status 401 Unauthorized: Missing bearer"}',
      '{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized"}}'
    ].join('\n')
    expect(() => normalizeManagerCliOutput(stdout, CHAT_FORMAT)).toThrow('Authentication required')
  })

  it('leaves Claude and Cursor result objects to the regular parser', () => {
    const claude = JSON.stringify({ type: 'result', subtype: 'success', result: reply })
    expect(readCodexEventStream(claude)).toBeNull()
    expect(JSON.parse(normalizeManagerCliOutput(claude, CHAT_FORMAT)).reply).toBe('Hello from Codex')
  })
})
