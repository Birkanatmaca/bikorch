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

describe('modern CLI screens', () => {
  const claudeIdle = [
    '──────────────────────────────────────',
    '❯ Try "edit <filepath> to..."',
    '──────────────────────────────────────',
    '  ⏵⏵ auto mode on (shift+tab to cycle)            ◐ medium · /effort'
  ].join('\n')

  it('sees Claude Code 2.x at rest, with a placeholder and a status line under the prompt', () => {
    expect(inferCliActivity(claudeIdle)).toBe('waiting')
  })

  it('sees Claude Code working', () => {
    expect(inferCliActivity('✻ Pondering… (12s · ↓ 1.2k tokens · esc to interrupt)\n❯ \n  ⏵⏵ auto mode on')).toBe('busy')
  })

  it('lets the newest state win in a stream that still holds the previous one', () => {
    expect(inferCliActivity('✻ Working… (esc to interrupt)\nDone.\n' + claudeIdle)).toBe('waiting')
    expect(inferCliActivity(claudeIdle + '\n✻ Working… (3s · esc to interrupt)')).toBe('busy')
  })

  it('does not mistake the effort label for a spinner', () => {
    expect(inferCliActivity('Some output\n◐ medium · /effort')).toBeNull()
  })
})

describe('reading a rendered screen', () => {
  it('treats a visible "esc to interrupt" as working even though input hints sit below it', () => {
    const working = '✻ Pondering… (8s · esc to interrupt)\n❯ \n  ⏵⏵ auto mode on (shift+tab to cycle)'
    expect(inferCliActivity(working, { screen: true })).toBe('busy')
    expect(inferCliActivity('❯ Try "fix lint"\n  ⏵⏵ auto mode on (shift+tab to cycle)', { screen: true })).toBe('waiting')
  })
})
