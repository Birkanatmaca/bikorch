import { describe, expect, it } from 'vitest'
import { messageRequestsCliWork } from '../message-intent'

describe('Secretary message intent', () => {
  it('treats explicit CLI work as a dispatch request', () => {
    expect(messageRequestsCliWork('herhangi bir cli seç ve merhaba promptu gönder')).toBe(true)
    expect(messageRequestsCliWork('helper projesini analiz et')).toBe(true)
    expect(messageRequestsCliWork('open CLI and review the tests')).toBe(true)
  })

  it('keeps ordinary secretary conversation from becoming a plan', () => {
    expect(messageRequestsCliWork('merhaba')).toBe(false)
    expect(messageRequestsCliWork('teşekkürler, sonra ne yapalım?')).toBe(false)
    expect(messageRequestsCliWork('What should I work on next?')).toBe(false)
  })
})
