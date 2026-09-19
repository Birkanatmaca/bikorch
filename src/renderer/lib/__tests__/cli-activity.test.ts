import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliActivityTracker, inferCliActivity } from '../cli-activity'
import type { PtySessionStatus } from '@shared/contracts/pty'

afterEach(() => {
  vi.useRealTimers()
})

describe('CliActivityTracker', () => {
  it('keeps a CLI busy while output is temporarily quiet', () => {
    let status: PtySessionStatus | undefined
    const apply = vi.fn((next: 'waiting' | 'busy') => {
      status = next
    })
    const tracker = new CliActivityTracker({
      apply,
      getStatus: () => status
    })

    tracker.feed('⠋')
    expect(apply).toHaveBeenCalledWith('busy')
    expect(status).toBe('busy')

    tracker.feed(`\n${'ok '.repeat(500)}`)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(status).toBe('busy')
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

  it('recognizes a final prompt even if prior output contained a spinner', () => {
    expect(inferCliActivity('⠋ thinking\nCompleted\n❯ ')).toBe('waiting')
  })

  it('recognizes the Cursor Agent input caret', () => {
    expect(inferCliActivity('Cursor Agent ready\n› ')).toBe('waiting')
  })

  it('recognizes Cursor Agent welcome input text', () => {
    expect(inferCliActivity('Cursor Agent ready\n→ Plan, search, build anything')).toBe('waiting')
  })

  it('does not treat the workspace trust dialog as an idle prompt', () => {
    expect(
      inferCliActivity('⚠ Workspace Trust Required\nDo you trust the contents of this directory?\n▶ [a] Trust this workspace\n')
    ).toBeNull()
  })
})
