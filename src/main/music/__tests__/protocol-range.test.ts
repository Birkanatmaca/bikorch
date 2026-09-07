import { describe, expect, it } from 'vitest'
import { parseByteRange } from '../audio-format'

describe('music protocol ranges', () => {
  it('parses byte ranges for long mixes', () => {
    expect(parseByteRange('bytes=0-1023', 5000)).toEqual({ start: 0, end: 1023 })
    expect(parseByteRange('bytes=100-', 5000)).toEqual({ start: 100, end: 4999 })
    expect(parseByteRange(null, 5000)).toBeNull()
    expect(parseByteRange('bytes=8000-9000', 5000)).toBeNull()
  })
})
