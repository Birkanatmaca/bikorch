import { describe, expect, it } from 'vitest'
import {
  clampTerminalGrid,
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
