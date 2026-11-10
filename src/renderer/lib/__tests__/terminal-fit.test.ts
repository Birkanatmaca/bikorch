import { describe, expect, it } from 'vitest'
import {
  TERMINAL_SCROLL_INTENT_MS,
  TerminalScrollIntent,
  clampTerminalGrid,
  isScrollbackKey,
  shouldRestoreFollow,
  measureTerminalGrid,
  shouldPinTerminalToBottom,
  terminalGridEquals,
  viewportIsAtBottom
} from '../terminal-fit'

describe('clampTerminalGrid', () => {
  it('floors and clamps to the supported PTY range', () => {
    expect(clampTerminalGrid(80.9, 24.2)).toEqual({ cols: 80, rows: 24 })
    expect(clampTerminalGrid(2, 1)).toEqual({ cols: 20, rows: 6 })
    expect(clampTerminalGrid(999, 999)).toEqual({ cols: 400, rows: 200 })
  })
})

describe('measureTerminalGrid', () => {
  it('returns null only when the host is effectively invisible', () => {
    expect(
      measureTerminalGrid({ clientWidth: 10, clientHeight: 200 }, { width: 8, height: 16 })
    ).toBeNull()
    expect(
      measureTerminalGrid({ clientWidth: 400, clientHeight: 10 }, { width: 8, height: 16 })
    ).toBeNull()
  })

  it('keeps xterm and PTY on the same supported minimum grid in a tiny pane', () => {
    expect(measureTerminalGrid({ clientWidth: 40, clientHeight: 25 }, null, { cols: 2, rows: 1 }))
      .toEqual({ cols: 20, rows: 6 })
  })

  it('handles narrow-tall and wide-short hosts independently', () => {
    expect(measureTerminalGrid({ clientWidth: 90, clientHeight: 500 }, null, { cols: 9, rows: 41 }))
      .toEqual({ cols: 20, rows: 41 })
    expect(measureTerminalGrid({ clientWidth: 1000, clientHeight: 32 }, null, { cols: 110, rows: 2 }))
      .toEqual({ cols: 110, rows: 6 })
  })

  it('prefers real cell metrics over FitAddon rounding', () => {
    expect(
      measureTerminalGrid(
        { clientWidth: 808, clientHeight: 481 },
        { width: 8, height: 16 },
        { cols: 99, rows: 29 }
      )
    ).toEqual({ cols: 101, rows: 30 })
  })

  it('falls back to proposed dimensions when cell size is missing', () => {
    expect(
      measureTerminalGrid({ clientWidth: 800, clientHeight: 480 }, null, { cols: 100, rows: 30 })
    ).toEqual({ cols: 100, rows: 30 })
  })
})

describe('viewport pinning', () => {
  it('treats the viewport as at-bottom within a small slop', () => {
    expect(
      viewportIsAtBottom({ scrollTop: 964, scrollHeight: 1000, clientHeight: 36 }, 36)
    ).toBe(true)
    expect(
      viewportIsAtBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 36 }, 36)
    ).toBe(false)
  })

  it('pins full-screen alternate-buffer TUIs but preserves normal scroll history', () => {
    expect(shouldPinTerminalToBottom(true, false)).toBe(true)
    expect(shouldPinTerminalToBottom(false, true)).toBe(true)
    expect(shouldPinTerminalToBottom(false, false)).toBe(false)
  })

  it('compares grid sizes by integer cols/rows', () => {
    expect(terminalGridEquals({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(true)
    expect(terminalGridEquals({ cols: 80, rows: 24 }, { cols: 80, rows: 25 })).toBe(false)
  })
})

describe('TerminalScrollIntent', () => {
  it('counts a scroll as intentional only shortly after a gesture or while the pointer is held', () => {
    const intent = new TerminalScrollIntent()
    expect(intent.isIntentional(1000)).toBe(false)
    intent.note(1000)
    expect(intent.isIntentional(1000 + TERMINAL_SCROLL_INTENT_MS)).toBe(true)
    expect(intent.isIntentional(1001 + TERMINAL_SCROLL_INTENT_MS)).toBe(false)
    intent.pointerDown()
    expect(intent.isIntentional(99_999)).toBe(true)
    intent.pointerUp(100_000)
    expect(intent.isIntentional(100_000 + TERMINAL_SCROLL_INTENT_MS)).toBe(true)
    expect(intent.isIntentional(100_001 + TERMINAL_SCROLL_INTENT_MS)).toBe(false)
  })
})

describe('isScrollbackKey', () => {
  it('matches modified navigation keys only', () => {
    expect(isScrollbackKey({ key: 'PageUp', shiftKey: true, metaKey: false, ctrlKey: false })).toBe(true)
    expect(isScrollbackKey({ key: 'PageUp', shiftKey: false, metaKey: false, ctrlKey: false })).toBe(false)
    expect(isScrollbackKey({ key: 'a', shiftKey: true, metaKey: false, ctrlKey: false })).toBe(false)
  })
})

describe('shouldRestoreFollow', () => {
  it('snaps back only when following output and the view drifted above the live screen', () => {
    expect(shouldRestoreFollow({ viewportY: 10, baseY: 40 }, true)).toBe(true)
    expect(shouldRestoreFollow({ viewportY: 40, baseY: 40 }, true)).toBe(false)
    expect(shouldRestoreFollow({ viewportY: 10, baseY: 40 }, false)).toBe(false)
  })
})
