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
  it('returns null when the host is too small to fit a CLI chrome', () => {
    expect(
      measureTerminalGrid({ clientWidth: 40, clientHeight: 200 }, { width: 8, height: 16 })
    ).toBeNull()
    expect(
      measureTerminalGrid({ clientWidth: 400, clientHeight: 20 }, { width: 8, height: 16 })
    ).toBeNull()
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

  it('always pins CLI TUIs after resize, and keeps a shell pinned if it was at the bottom', () => {
    expect(shouldPinTerminalToBottom(true, false)).toBe(true)
    expect(shouldPinTerminalToBottom(false, true)).toBe(true)
    expect(shouldPinTerminalToBottom(false, false)).toBe(false)
  })

  it('compares grid sizes by integer cols/rows', () => {
    expect(terminalGridEquals({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(true)
    expect(terminalGridEquals({ cols: 80, rows: 24 }, { cols: 80, rows: 25 })).toBe(false)
  })
})
