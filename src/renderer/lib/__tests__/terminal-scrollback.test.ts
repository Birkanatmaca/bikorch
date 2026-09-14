import { describe, expect, it } from 'vitest'
import { applyRendererResourceProfile } from '../resource-limits'
import { getTerminalOptions } from '../terminal-theme'

describe('terminal scrollback profiles', () => {
  it('uses the active resource profile for xterm scrollback', () => {
    applyRendererResourceProfile('performance')
    expect(getTerminalOptions('terminal').scrollback).toBe(8000)
    expect(getTerminalOptions('cursor').scrollback).toBe(8000)

    applyRendererResourceProfile('memory-saver')
    expect(getTerminalOptions('terminal').scrollback).toBe(2000)
    expect(getTerminalOptions('cursor').scrollback).toBe(1500)
  })
})
