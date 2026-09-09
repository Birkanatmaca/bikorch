import { describe, expect, it } from 'vitest'
import type { DeveloperEvent } from '@shared/contracts/developer-intelligence'
import {
  pairAgentSessions,
  parsePorcelainPaths,
  parseSessionRecordId,
  sessionRecordId,
  toSessionSummary
} from '../session-timeline'

function started(id: string, sessionId: string, at: number): DeveloperEvent {
  return {
    id,
    type: 'agent.session.started',
    occurredAt: at,
    sessionId,
    provider: 'claude',
    payload: { kind: 'claude', launchMode: 'normal' }
  }
}

function ended(id: string, sessionId: string, at: number, durationMs: number): DeveloperEvent {
  return {
    id,
    type: 'agent.session.ended',
    occurredAt: at,
    sessionId,
    provider: 'claude',
    payload: {
      kind: 'claude',
      durationMs,
      promptCount: 3,
      exitCode: 0,
      closeReason: 'exited',
      changedFiles: ['src/a.ts'],
      commits: [{ shortHash: 'abc1234', subject: 'fix login' }]
    }
  }
}

describe('agent session timeline', () => {
  it('pairs start/end and keeps a later run of the same panel id', () => {
    const pairs = pairAgentSessions([
      started('s1', 'panel-a', 1000),
      ended('e1', 'panel-a', 2000, 1000),
      started('s2', 'panel-a', 3000)
    ])
    expect(pairs).toHaveLength(2)
    expect(pairs[0]?.id).toBe(sessionRecordId('panel-a', 3000))
    expect(pairs[0]?.end).toBeUndefined()
    expect(pairs[1]?.end?.id).toBe('e1')
    expect(toSessionSummary(pairs[0]!, 4000).stillOpen).toBe(true)
    expect(toSessionSummary(pairs[1]!).fileCount).toBe(1)
    expect(toSessionSummary(pairs[1]!).commitCount).toBe(1)
    expect(toSessionSummary(pairs[1]!, 4000).durationMs).toBe(1000)
  })

  it('does not attach a later run’s end event to an earlier start of the same panel', () => {
    const pairs = pairAgentSessions([
      started('s1', 'panel-a', 1000),
      started('s2', 'panel-a', 3000),
      ended('e2', 'panel-a', 4000, 1000)
    ])
    expect(pairs).toHaveLength(2)
    expect(pairs.find((pair) => pair.startedAt === 1000)?.end).toBeUndefined()
    expect(pairs.find((pair) => pair.startedAt === 3000)?.end?.id).toBe('e2')
  })

  it('parses record ids and porcelain paths', () => {
    const id = sessionRecordId('abc', 99)
    expect(parseSessionRecordId(id)).toEqual({ sessionId: 'abc', startedAt: 99 })
    expect(parsePorcelainPaths(' M src/app.ts\n?? notes.md\n')).toEqual(['src/app.ts', 'notes.md'])
  })
})
