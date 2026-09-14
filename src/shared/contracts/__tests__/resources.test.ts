import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESOURCE_PROFILE,
  parseResourceProfile,
  resourceLimitsFor
} from '../resources'

describe('resource profiles', () => {
  it('defaults to balanced and keeps idle CLI auto-stop disabled', () => {
    expect(parseResourceProfile('nope')).toBe(DEFAULT_RESOURCE_PROFILE)
    expect(resourceLimitsFor('balanced').idleCliStopMs).toBeNull()
    expect(resourceLimitsFor('memory-saver').idleCliStopMs).toBeNull()
    expect(resourceLimitsFor('performance').idleCliStopMs).toBeNull()
  })

  it('tightens webview, scrollback, and cache limits in Memory Saver', () => {
    const performance = resourceLimitsFor('performance')
    const saver = resourceLimitsFor('memory-saver')
    expect(saver.webChatIdleMs).toBeLessThan(performance.webChatIdleMs)
    expect(saver.terminalScrollback).toBeLessThan(performance.terminalScrollback)
    expect(saver.cliTerminalScrollback).toBeLessThan(performance.cliTerminalScrollback)
    expect(saver.inactiveDiffCacheProjects).toBeLessThan(performance.inactiveDiffCacheProjects)
    expect(saver.browserIdleMs).toBeGreaterThan(0)
    expect(performance.browserIdleMs).toBe(0)
  })
})
