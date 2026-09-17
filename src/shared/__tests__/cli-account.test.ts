import { describe, expect, it } from 'vitest'
import type { AiAccount } from '../contracts/accounts'
import type { CliUsageInfo } from '../contracts/usage'
import { pickCliAccountId, usagePressure } from '../cli-account'

function account(id: string, ready = true): Pick<AiAccount, 'id' | 'kind' | 'profileReady'> {
  return { id, kind: 'cursor', profileReady: ready }
}

function usage(id: string, usedPercent: number, status: CliUsageInfo['status'] = 'available'): CliUsageInfo {
  return {
    kind: 'cursor',
    accountId: id,
    label: 'Cursor CLI',
    status,
    detail: 'ok',
    primary: { usedPercent, windowDurationMins: 43200, resetsAt: null }
  }
}

describe('pickCliAccountId', () => {
  it('skips an exhausted Cursor account for one with remaining usage', () => {
    expect(
      pickCliAccountId(
        'cursor',
        [account('full'), account('open')],
        [usage('full', 100), usage('open', 76.4)],
        'full'
      )
    ).toBe('open')
  })

  it('keeps the preferred account when it still has room', () => {
    expect(
      pickCliAccountId(
        'cursor',
        [account('a'), account('b')],
        [usage('a', 40), usage('b', 10)],
        'a'
      )
    ).toBe('a')
  })

  it('treats unavailable usage as exhausted', () => {
    expect(usagePressure(usage('x', 12, 'unavailable'))).toBe(101)
  })
})
