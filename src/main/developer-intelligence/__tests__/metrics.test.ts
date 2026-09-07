import { describe, expect, it } from 'vitest'
import type { DeveloperEvent } from '@shared/contracts/developer-intelligence'
import { computeMetrics, resolveMetricsRange, aggregatePromptMetrics, type MetricsInput } from '../metrics'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = new Date(2026, 8, 7, 15, 0, 0).getTime() // local afternoon

let counter = 0
function event<T extends DeveloperEvent>(partial: Omit<T, 'id'>): T {
  counter += 1
  return { id: `evt-${counter}`, ...partial } as T
}

function prompt(occurredAt: number, provider: string, projectId: string, extra: Partial<Extract<DeveloperEvent, { type: 'prompt.sent' }>['payload']> = {}): DeveloperEvent {
  return event({
    type: 'prompt.sent',
    occurredAt,
    provider,
    projectId,
    payload: { charCount: 120, textRetained: false, source: 'terminal', ...extra }
  })
}

function session(startAt: number, durationMs: number, provider: string, projectId: string, sessionId: string): DeveloperEvent[] {
  return [
    event({
      type: 'agent.session.started',
      occurredAt: startAt,
      provider,
      projectId,
      sessionId,
      payload: { kind: provider as 'claude', launchMode: 'normal' }
    }),
    event({
      type: 'agent.session.ended',
      occurredAt: startAt + durationMs,
      provider,
      projectId,
      sessionId,
      payload: { kind: provider as 'claude', durationMs, promptCount: 2, exitCode: 0 }
    })
  ]
}

function baseInput(events: DeveloperEvent[], overrides: Partial<MetricsInput> = {}): MetricsInput {
  return {
    events,
    range: resolveMetricsRange('7d', NOW),
    now: NOW,
    projectNames: { p1: 'Bikorch', p2: 'Backend' },
    projectCensus: [],
    promptFrameworkHints: {},
    promptAggregates: aggregatePromptMetrics([]),
    settings: { useGitActivity: true, useProjectFileContext: true },
    ...overrides
  }
}

describe('resolveMetricsRange', () => {
  it('computes today from local midnight', () => {
    const range = resolveMetricsRange('today', NOW)
    expect(new Date(range.from).getHours()).toBe(0)
    expect(range.to).toBe(NOW)
  })

  it('computes rolling windows and all-time', () => {
    expect(resolveMetricsRange('7d', NOW).from).toBe(NOW - 7 * DAY)
    expect(resolveMetricsRange('30d', NOW).from).toBe(NOW - 30 * DAY)
    expect(resolveMetricsRange('all', NOW).from).toBe(0)
    expect(new Date(resolveMetricsRange('month', NOW).from).getDate()).toBe(1)
  })
})

describe('computeMetrics', () => {
  it('reports zeros and unavailable metrics when there is no history', () => {
    const metrics = computeMetrics(baseInput([]))
    expect(metrics.overview.promptsSent).toBe(0)
    expect(metrics.overview.sessions).toBe(0)
    expect(metrics.overview.averagePromptChars.availability).toBe('unavailable')
    expect(metrics.overview.totalTokens.availability).toBe('unavailable')
    expect(metrics.overview.apiSpendUsd.availability).toBe('unavailable')
    expect(metrics.overview.mostActivePeriod).toBeNull()
    expect(metrics.languages.entries).toEqual([])
    expect(metrics.workflow.mostUsedAgent).toBeNull()
    expect(metrics.interpretations).toEqual([])
    expect(metrics.activity.dailyPrompts).toHaveLength(8)
  })

  it('counts prompts, sessions, projects and providers inside the range only', () => {
    const events = [
      prompt(NOW - HOUR, 'claude', 'p1'),
      prompt(NOW - 2 * HOUR, 'codex', 'p2'),
      prompt(NOW - 10 * DAY, 'claude', 'p1'), // previous period
      ...session(NOW - 3 * HOUR, 30 * 60 * 1000, 'claude', 'p1', 's1')
    ]
    const metrics = computeMetrics(baseInput(events))
    expect(metrics.overview.promptsSent).toBe(2)
    expect(metrics.overview.sessions).toBe(1)
    expect(metrics.overview.activeProjects).toBe(2)
    expect(metrics.overview.providersUsed).toBe(2)
    expect(metrics.overview.averagePromptChars).toEqual({ value: 120, availability: 'measured' })
    expect(metrics.overview.averageSessionDurationMs).toEqual({ value: 30 * 60 * 1000, availability: 'measured' })
    expect(metrics.overview.promptsDeltaPercent).toBe(100)
    expect(metrics.overview.mostActivePeriod).toMatch(/Afternoon|Morning/)
    expect(metrics.activity.lastActivityAt).toBe(NOW - HOUR)
  })

  it('never fabricates a delta without a previous period', () => {
    const metrics = computeMetrics(baseInput([prompt(NOW - HOUR, 'claude', 'p1')]))
    expect(metrics.overview.promptsDeltaPercent).toBeNull()
  })

  it('weights git files above project files above prompt hints for languages', () => {
    const events: DeveloperEvent[] = [
      event({
        type: 'git.commit',
        occurredAt: NOW - HOUR,
        projectId: 'p1',
        payload: { message: 'feat', fileCount: 4, files: [], languages: { typescript: 4 } }
      }),
      prompt(NOW - 2 * HOUR, 'claude', 'p1', { languageHints: ['go'] })
    ]
    const metrics = computeMetrics(
      baseInput(events, {
        projectCensus: [{ projectId: 'p1', fileCount: 10, byLanguage: { typescript: 5, python: 5 }, frameworks: ['React'] }]
      })
    )
    const byLabel = Object.fromEntries(metrics.languages.entries.map((entry) => [entry.label, entry.percent]))
    expect(byLabel['typescript']).toBeGreaterThan(byLabel['go'])
    expect(byLabel['typescript']).toBeGreaterThan(byLabel['python'])
    expect(metrics.languages.basis).toEqual([
      'Git changed files (4)',
      'Project files (10)',
      'Code blocks and file names in prompts (1)'
    ])
    const total = metrics.languages.entries.reduce((sum, entry) => sum + entry.percent, 0)
    expect(Math.round(total)).toBe(100)
  })

  it('respects privacy settings for git and project sources', () => {
    const events: DeveloperEvent[] = [
      event({
        type: 'git.commit',
        occurredAt: NOW - HOUR,
        projectId: 'p1',
        payload: { message: 'fix bug', fileCount: 1, files: [], languages: { go: 1 }, category: 'Debugging' }
      })
    ]
    const metrics = computeMetrics(
      baseInput(events, {
        settings: { useGitActivity: false, useProjectFileContext: false },
        projectCensus: [{ projectId: 'p1', fileCount: 3, byLanguage: { typescript: 3 }, frameworks: ['Electron'] }]
      })
    )
    expect(metrics.overview.commits).toBe(0)
    expect(metrics.languages.entries).toEqual([])
    expect(metrics.frameworks).toEqual([])
    expect(metrics.workflow.sessionsEndingInCommit.availability).toBe('unavailable')
  })

  it('derives work categories, workflow and sessions ending in a commit', () => {
    const events: DeveloperEvent[] = [
      ...session(NOW - 5 * HOUR, HOUR, 'claude', 'p1', 's1'),
      ...session(NOW - 3 * HOUR, HOUR, 'codex', 'p1', 's2'),
      ...session(NOW - 3 * HOUR + 10, HOUR, 'claude', 'p2', 's3'),
      ...session(NOW - 90 * 60 * 1000, HOUR, 'codex', 'p2', 's4'),
      prompt(NOW - 4.5 * HOUR, 'claude', 'p1', { category: 'Debugging' }),
      prompt(NOW - 4.4 * HOUR, 'claude', 'p1', { category: 'Debugging' }),
      prompt(NOW - 2.5 * HOUR, 'codex', 'p1', { category: 'Feature development' }),
      event({
        type: 'git.commit',
        occurredAt: NOW - 2.2 * HOUR,
        projectId: 'p1',
        payload: { message: 'add panel', fileCount: 2, files: [], languages: { typescript: 2 }, category: 'Feature development' }
      }),
      event({
        type: 'task.completed',
        occurredAt: NOW - 2.6 * HOUR,
        projectId: 'p1',
        payload: { taskId: 't1', title: 'Ship it', priority: 'high' }
      }),
      event({
        type: 'task.completed',
        occurredAt: NOW - 6 * HOUR,
        projectId: 'p1',
        payload: { taskId: 't2', title: 'Outside any session', priority: 'low' }
      })
    ]
    const metrics = computeMetrics(baseInput(events))

    expect(metrics.workflow.mostUsedAgent).toBe('claude')
    expect(metrics.workflow.mostUsedProject).toEqual({ id: 'p1', name: 'Bikorch' })
    expect(metrics.workflow.promptsPerSession).toEqual({ value: 0.8, availability: 'measured' })
    // Only the codex session s2 (p1) has a commit inside its window: 1 of 4 sessions.
    expect(metrics.workflow.sessionsEndingInCommit).toEqual({ value: 25, availability: 'measured' })
    expect(metrics.workflow.tasksCompletedDuringSessions).toBe(1)
    expect(metrics.overview.tasksCompleted).toBe(2)
    expect(metrics.workflow.commonAgentSequence).toEqual(['claude', 'codex'])

    const categories = Object.fromEntries(metrics.workCategories.entries.map((entry) => [entry.label, entry.percent]))
    expect(categories['Debugging']).toBe(50)
    expect(categories['Feature development']).toBe(50)
    expect(metrics.workCategories.basis).toContain('3 prompts and 1 commit')
  })

  it('accumulates framework evidence with confidence tiers', () => {
    const metrics = computeMetrics(
      baseInput([], {
        projectCensus: [
          { projectId: 'p1', fileCount: 1, byLanguage: {}, frameworks: ['React', 'Electron'] },
          { projectId: 'p2', fileCount: 1, byLanguage: {}, frameworks: ['React'] }
        ],
        promptFrameworkHints: { React: 9, Docker: 1 }
      })
    )
    const react = metrics.frameworks.find((framework) => framework.name === 'React')
    const docker = metrics.frameworks.find((framework) => framework.name === 'Docker')
    const electron = metrics.frameworks.find((framework) => framework.name === 'Electron')
    expect(react).toMatchObject({ evidenceCount: 9, confidence: 'high' })
    expect(react?.sources).toEqual(expect.arrayContaining(['project files', 'prompts']))
    expect(electron).toMatchObject({ evidenceCount: 2, confidence: 'low' })
    expect(docker).toMatchObject({ evidenceCount: 1, confidence: 'low', sources: ['prompts'] })
  })

  it('labels interpretations as readings of measured activity', () => {
    const events: DeveloperEvent[] = [
      ...session(NOW - HOUR, HOUR, 'claude', 'p1', 's1'),
      prompt(NOW - 30 * 60 * 1000, 'claude', 'p1', { category: 'Debugging' }),
      prompt(NOW - 20 * 60 * 1000, 'claude', 'p1', { category: 'Debugging' }),
      prompt(NOW - 10 * DAY, 'claude', 'p1')
    ]
    const metrics = computeMetrics(
      baseInput(events, {
        projectCensus: [{ projectId: 'p1', fileCount: 10, byLanguage: { typescript: 8, go: 2 }, frameworks: ['React'] }]
      })
    )
    expect(metrics.interpretations.length).toBeGreaterThan(0)
    expect(metrics.interpretations.some((item) => item.text.includes('TypeScript'))).toBe(true)
    expect(metrics.interpretations.some((item) => item.text.includes('Claude Code'))).toBe(true)
    expect(metrics.interpretations.some((item) => /increased|decreased/.test(item.text))).toBe(true)
  })

  it('aggregates prompt token and cost fields when present', () => {
    const metrics = computeMetrics(
      baseInput([], {
        promptAggregates: aggregatePromptMetrics([
          {
            id: 'p1',
            createdAt: NOW,
            prompt: 'hi',
            source: 'terminal',
            redactedCount: 0,
            inputTokenCount: 100,
            outputTokenCount: 50,
            costUsd: 0.12,
            costSource: 'official'
          },
          {
            id: 'p2',
            createdAt: NOW,
            prompt: 'yo',
            source: 'terminal',
            redactedCount: 0,
            inputTokenCount: 20,
            outputTokenCount: 10,
            costUsd: 0.03,
            costSource: 'estimated'
          }
        ])
      })
    )
    expect(metrics.overview.totalTokens).toEqual({ value: 180, availability: 'measured' })
    expect(metrics.overview.apiSpendUsd).toEqual({ value: 0.15, availability: 'estimated' })
  })

  it('includes git file changes and usage snapshots in language and usage metrics', () => {
    const events: DeveloperEvent[] = [
      event({
        type: 'git.file.changed',
        occurredAt: NOW - HOUR,
        projectId: 'p1',
        payload: {
          fileCount: 2,
          files: ['a.go', 'b.go'],
          languages: { go: 2 },
          stagedCount: 1,
          unstagedCount: 1
        }
      }),
      event({
        type: 'usage.snapshot',
        occurredAt: NOW - 30 * 60 * 1000,
        provider: 'claude',
        payload: { kind: 'claude', primaryUsedPercent: 40 }
      }),
      event({
        type: 'usage.snapshot',
        occurredAt: NOW - 20 * 60 * 1000,
        provider: 'claude',
        payload: { kind: 'claude', primaryUsedPercent: 60 }
      })
    ]
    const metrics = computeMetrics(baseInput(events))
    expect(metrics.languages.entries.some((entry) => entry.label === 'go')).toBe(true)
    expect(metrics.overview.averagePrimaryLimitUsed).toEqual({ value: 50, availability: 'measured' })
  })
})
