import { describe, expect, it } from 'vitest'
import { appendOutputBuffer, hostHasRunningSessions } from '../session-store'

describe('PTY host session store', () => {
  it('treats only running sessions as live work', () => {
    const sessions = new Map<string, { status: string }>([
      ['alive', { status: 'running' }],
      ['dead', { status: 'stopped' }]
    ])
    sessions.delete('dead')
    expect(hostHasRunningSessions(sessions)).toBe(true)
    sessions.delete('alive')
    expect(hostHasRunningSessions(sessions)).toBe(false)
  })

  it('trims replay output to the cap', () => {
    expect(appendOutputBuffer('abc', 'defghi', 6)).toBe('defghi')
    expect(appendOutputBuffer('aaaaaa', 'bbb', 6)).toBe('aaabbb')
    expect(appendOutputBuffer('', 'x'.repeat(10), 6)).toBe('xxxxxx')
  })
})
