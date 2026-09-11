import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliActivityTracker } from '../cli-activity'
import type { PtySessionStatus } from '@shared/contracts/pty'

afterEach(() => {
  vi.useRealTimers()
})

describe('CliActivityTracker', () => {
  it('marks a spinner as busy, then waiting after idle output', () => {
    vi.useFakeTimers()
    let status: PtySessionStatus | undefined
    const apply = vi.fn((next: 'waiting' | 'busy') => {
      status = next
    })
    const tracker = new CliActivityTracker({
      apply,
      getStatus: () => status,
      idleMs: 1800
    })

    tracker.feed('⠋')
    expect(apply).toHaveBeenCalledWith('busy')
    expect(status).toBe('busy')

    tracker.feed(`\n${'ok '.repeat(500)}`)
    vi.advanceTimersByTime(1799)
    expect(apply).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    expect(apply).toHaveBeenCalledWith('waiting')
    tracker.dispose()
  })

  it('returns to waiting when an idle prompt appears', () => {
    let status: PtySessionStatus | undefined = 'busy'
    const apply = vi.fn((next: 'waiting' | 'busy') => {
      status = next
    })
    const tracker = new CliActivityTracker({
      apply,
      getStatus: () => status
    })
    tracker.feed('\n❯ ')
    expect(apply).toHaveBeenCalledWith('waiting')
    tracker.dispose()
  })
})
