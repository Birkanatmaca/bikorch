import { describe, expect, it } from 'vitest'
import { evictRecordKeys, keysToKeep, rememberRecent } from '../inactive-cache'

describe('inactive cache eviction', () => {
  it('keeps the active project plus a few recent ones', () => {
    const recents = rememberRecent(rememberRecent(['a'], 'b'), 'c')
    const keep = keysToKeep('c', recents, 1)
    expect(keep.has('c')).toBe(true)
    expect(keep.size).toBe(2)
    const next = evictRecordKeys(
      { a: 'big-a', b: 'big-b', c: 'big-c', d: 'big-d' },
      keep
    )
    expect(next).toEqual({ c: 'big-c', b: 'big-b' })
  })

  it('never drops the active key even when recents are empty', () => {
    expect([...keysToKeep('live', [], 0)]).toEqual(['live'])
  })
})
