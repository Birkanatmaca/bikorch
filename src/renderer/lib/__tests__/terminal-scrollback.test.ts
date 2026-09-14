import { afterEach, describe, expect, it } from 'vitest'
import { applyRendererResourceProfile } from '../resource-limits'
import { getTerminalOptions } from '../terminal-theme'
import {
  applyLiveTerminalScrollback,
  liveTerminalCount,
  registerLiveTerminal,
  unregisterLiveTerminal
} from '../live-terminals'

describe('terminal scrollback profiles', () => {
  it('uses the active resource profile for xterm scrollback', () => {
    applyRendererResourceProfile('performance')
    expect(getTerminalOptions('terminal').scrollback).toBe(8000)
    expect(getTerminalOptions('cursor').scrollback).toBe(8000)

    applyRendererResourceProfile('memory-saver')
    expect(getTerminalOptions('terminal').scrollback).toBe(2000)
    expect(getTerminalOptions('cursor').scrollback).toBe(1500)
  })

  it('updates already-open xterm instances when the profile changes', () => {
    applyRendererResourceProfile('performance')
    const terminal = { options: { scrollback: getTerminalOptions('terminal').scrollback } }
    const cli = { options: { scrollback: getTerminalOptions('cursor').scrollback } }
    registerLiveTerminal('term-1', 'terminal', terminal)
    registerLiveTerminal('cli-1', 'cursor', cli)
    expect(liveTerminalCount()).toBe(2)

    applyRendererResourceProfile('memory-saver')
    applyLiveTerminalScrollback()
    expect(terminal.options.scrollback).toBe(2000)
    expect(cli.options.scrollback).toBe(1500)

    unregisterLiveTerminal('term-1')
    unregisterLiveTerminal('cli-1')
    expect(liveTerminalCount()).toBe(0)
  })
})
