import { describe, expect, it } from 'vitest'
import { cliPanelsToOpen, messageRequestsCliWork } from '../message-intent'

describe('Secretary message intent', () => {
  it('treats explicit CLI work as a dispatch request', () => {
    expect(messageRequestsCliWork('herhangi bir cli seç ve merhaba promptu gönder')).toBe(true)
    expect(messageRequestsCliWork('helper projesini analiz et')).toBe(true)
    expect(messageRequestsCliWork('open CLI and review the tests')).toBe(true)
  })

  it('opens the requested CLI panels without turning the request into work', () => {
    expect(cliPanelsToOpen('çalışma alanına antigravity cli açar mısın 2 tane')).toEqual(['antigravity', 'antigravity'])
    expect(cliPanelsToOpen('open two cursor CLIs')).toEqual(['cursor', 'cursor'])
    expect(cliPanelsToOpen('antigravity cli aç ve projeyi analiz et')).toEqual([])
  })

  it('keeps ordinary secretary conversation from becoming a plan', () => {
    expect(messageRequestsCliWork('merhaba')).toBe(false)
    expect(messageRequestsCliWork('teşekkürler, sonra ne yapalım?')).toBe(false)
    expect(messageRequestsCliWork('What should I work on next?')).toBe(false)
  })
})
