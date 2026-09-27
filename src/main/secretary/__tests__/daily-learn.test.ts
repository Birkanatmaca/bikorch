import { describe, expect, it } from 'vitest'
import type { DeveloperMemory } from '@shared/contracts/developer-intelligence'
import {
  lessonForDate,
  localDateKey,
  memoriesForDailyLearn,
  parseDailyLearnLesson,
  parseDailyLearnRecord,
  recentTopics,
  withFailure,
  withLesson
} from '../daily-learn'

function memory(overrides: Partial<DeveloperMemory>): DeveloperMemory {
  return {
    id: 'm',
    scope: 'global',
    category: 'Languages',
    content: 'Writes Go services every week.',
    confidence: 1,
    evidenceCount: 2,
    firstSeenAt: 1,
    lastSeenAt: 1,
    source: 'ai',
    enabled: true,
    ...overrides
  }
}

describe('daily learn', () => {
  it('formats the local calendar day', () => {
    expect(localDateKey(new Date(2026, 8, 7))).toBe('2026-09-07')
  })

  it('keeps enabled work memories and drops About me', () => {
    const facts = memoriesForDailyLearn([
      memory({ id: 'about', category: 'About me', content: 'Lives in a city and prefers tea.', lastSeenAt: 9 }),
      memory({ id: 'off', category: 'Languages', content: 'Writes Rust on weekends.', enabled: false, lastSeenAt: 8 }),
      memory({ id: 'go', category: 'Languages', content: 'Writes Go services every week.', lastSeenAt: 3 }),
      memory({ id: 'ui', category: 'Tooling', content: 'Builds mobile screens in React.', lastSeenAt: 5 }),
      memory({ id: 'short', category: 'Workflow', content: 'tiny', lastSeenAt: 7 })
    ])
    expect(facts.map((fact) => fact.content)).toEqual([
      'Writes Go services every week.',
      'Builds mobile screens in React.'
    ])
  })

  it('accepts a lesson and rejects a short one', () => {
    expect(parseDailyLearnLesson({
      topic: 'Go concurrency',
      body: 'Goroutines let Go work proceed at the same time. Channels keep that work coordinated, so a service can wait without blocking every request.',
      basis: 'Languages'
    }, '2026-09-27')).toMatchObject({ date: '2026-09-27', topic: 'Go concurrency', basis: 'Languages' })
    expect(parseDailyLearnLesson({ topic: 'Go', body: 'Too short.', basis: 'Languages' }, '2026-09-27')).toBeNull()
    expect(parseDailyLearnLesson({
      topic: 'State',
      body: 'useState keeps a screen value and redraws when it changes. That is how a mobile view stays in step with what the user just did.',
      basis: 'Identity'
    }, '2026-09-27')?.basis).toBe('Work')
  })

  it('returns today from the record and keeps earlier topics for the next day', () => {
    const saved = withLesson({ lessons: [], failedOn: '2026-09-26' }, {
      date: '2026-09-26',
      topic: 'Go concurrency',
      body: 'Goroutines let Go work proceed at the same time. Channels keep that work coordinated, so a service can wait without blocking every request.',
      basis: 'Languages'
    })
    const today = withLesson(saved, {
      date: '2026-09-27',
      topic: 'useState',
      body: 'useState keeps a screen value and redraws when it changes. That is how a mobile view stays in step with what the user just did.',
      basis: 'Tooling'
    })
    expect(lessonForDate(today, '2026-09-27')?.topic).toBe('useState')
    expect(recentTopics(today, '2026-09-27')).toEqual(['Go concurrency'])
    expect(today.failedOn).toBeNull()
    const failed = withFailure(saved, '2026-09-27')
    expect(failed.failedOn).toBe('2026-09-27')
    expect(parseDailyLearnRecord(JSON.stringify(today)).lessons).toHaveLength(2)
    expect(parseDailyLearnRecord('not-json')).toEqual({ lessons: [], failedOn: null })
  })
})
