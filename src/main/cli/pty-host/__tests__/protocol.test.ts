import { describe, expect, it } from 'vitest'
import { encodeMessage, feedNdjson } from '../protocol'

describe('pty-host protocol', () => {
  it('splits ndjson messages across chunks', () => {
    const first = feedNdjson('', '{"v":1,"type":"pong","id":"a"}\n{"v":1')
    expect(first.messages).toEqual(['{"v":1,"type":"pong","id":"a"}'])
    const second = feedNdjson(first.buffer, ',"type":"hello"}\n')
    expect(second.messages).toEqual(['{"v":1,"type":"hello"}'])
    expect(second.buffer).toBe('')
  })

  it('encodes trailing newline', () => {
    expect(encodeMessage({ v: 1, id: '1', type: 'pong' })).toBe(
      '{"v":1,"id":"1","type":"pong"}\n'
    )
  })
})
