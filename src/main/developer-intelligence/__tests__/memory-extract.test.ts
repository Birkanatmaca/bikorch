import { describe, expect, it } from 'vitest'
import type { DeveloperMemory, DeveloperMetrics, PromptRecord } from '@shared/contracts/developer-intelligence'
import { extractMemoryCandidates, rankMemoriesForContext } from '../memory-extract'
import { computeMetrics, resolveMetricsRange, aggregatePromptMetrics, type MetricsInput } from '../metrics'

const NOW = new Date(2026, 8, 7, 15, 0, 0).getTime()
const HOUR = 60 * 60 * 1000

function emptyMetrics(overrides: Partial<DeveloperMetrics> = {}): DeveloperMetrics {
  const input: MetricsInput = {
    events: [
      {
        id: 'p1',
        type: 'prompt.sent',
        occurredAt: NOW - HOUR,
        provider: 'claude',
        projectId: 'proj-1',
        payload: { charCount: 80, textRetained: false, source: 'terminal', category: 'Debugging' }
      },
      {
        id: 'p2',
        type: 'prompt.sent',
        occurredAt: NOW - HOUR + 1,
        provider: 'claude',
        projectId: 'proj-1',
        payload: { charCount: 90, textRetained: false, source: 'terminal', category: 'Debugging' }
      },
      {
        id: 'p3',
        type: 'prompt.sent',
        occurredAt: NOW - HOUR + 2,
        provider: 'claude',
        projectId: 'proj-1',
        payload: { charCount: 70, textRetained: false, source: 'terminal', category: 'Debugging' }
      },
      {
        id: 'p4',
        type: 'prompt.sent',
        occurredAt: NOW - HOUR + 3,
        provider: 'claude',
        projectId: 'proj-1',
        payload: { charCount: 60, textRetained: false, source: 'terminal', category: 'Debugging' }
      },
      {
        id: 's1',
        type: 'agent.session.started',
        occurredAt: NOW - 2 * HOUR,
        provider: 'claude',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        payload: { kind: 'claude', launchMode: 'normal' }
      },
      {
        id: 's1e',
        type: 'agent.session.ended',
        occurredAt: NOW - HOUR,
        provider: 'claude',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        payload: { kind: 'claude', durationMs: HOUR, promptCount: 4, exitCode: 0 }
      },
      {
        id: 's2',
        type: 'agent.session.started',
        occurredAt: NOW - 3 * HOUR,
        provider: 'codex',
        projectId: 'proj-1',
        sessionId: 'sess-2',
        payload: { kind: 'codex', launchMode: 'normal' }
      },
      {
        id: 's3',
        type: 'agent.session.started',
        occurredAt: NOW - 4 * HOUR,
        provider: 'claude',
        projectId: 'proj-1',
        sessionId: 'sess-3',
        payload: { kind: 'claude', launchMode: 'normal' }
      },
      {
        id: 'c1',
        type: 'git.commit',
        occurredAt: NOW - 90 * 60 * 1000,
        projectId: 'proj-1',
        payload: { message: 'fix crash', fileCount: 6, files: [], languages: { typescript: 6 }, category: 'Debugging' }
      }
    ],
    range: resolveMetricsRange('7d', NOW),
    now: NOW,
    projectNames: { 'proj-1': 'Bikorch' },
    projectCensus: [
      { projectId: 'proj-1', fileCount: 20, byLanguage: { typescript: 16, go: 4 }, frameworks: ['React', 'Electron'] }
    ],
    promptFrameworkHints: { React: 4 },
    promptAggregates: aggregatePromptMetrics([]),
    settings: { useGitActivity: true, useProjectFileContext: true }
  }
  return { ...computeMetrics(input), ...overrides }
}

function promptRecord(prompt: string, id: string): PromptRecord {
  return {
    id,
    createdAt: NOW,
    prompt,
    source: 'terminal',
    redactedCount: 0
  }
}

function memory(partial: Partial<DeveloperMemory> & Pick<DeveloperMemory, 'id' | 'content'>): DeveloperMemory {
  return {
    scope: 'global',
    category: 'Other',
    confidence: 0.5,
    evidenceCount: 1,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    source: 'ai',
    enabled: true,
    ...partial
  }
}

describe('extractMemoryCandidates', () => {
  it('does not invent memories from empty metrics', () => {
    const metrics = computeMetrics({
      events: [],
      range: resolveMetricsRange('7d', NOW),
      now: NOW,
      projectNames: {},
      projectCensus: [],
      promptFrameworkHints: {},
      promptAggregates: aggregatePromptMetrics([]),
      settings: { useGitActivity: true, useProjectFileContext: true }
    })
    expect(extractMemoryCandidates({ metrics, projectCensus: [], prompts: [], projectNames: {} })).toEqual([])
  })

  it('extracts language, framework, category, agent and project memories from strong evidence', () => {
    const metrics = emptyMetrics()
    const candidates = extractMemoryCandidates({
      metrics,
      projectCensus: [
        { projectId: 'proj-1', fileCount: 20, byLanguage: { typescript: 16, go: 4 }, frameworks: ['React', 'Electron'] }
      ],
      prompts: [],
      projectNames: { 'proj-1': 'Bikorch' }
    })
    const byKey = Object.fromEntries(candidates.map((item) => [item.key, item]))
    expect(byKey['language-primary']?.content).toMatch(/TypeScript/)
    expect(byKey['project-language:proj-1']?.scope).toBe('project')
    expect(byKey['project-language:proj-1']?.content).toMatch(/Bikorch/)
    expect(byKey['frameworks-core']?.content).toMatch(/React/)
    expect(byKey['category-primary']?.content).toMatch(/debugging/)
    expect(byKey['agent-primary']?.content).toMatch(/Claude Code/)
    expect(byKey['project-focus:proj-1']?.content).toMatch(/Bikorch/)
  })

  it('extracts style memories only after repeated prompt evidence', () => {
    const metrics = emptyMetrics()
    const once = extractMemoryCandidates({
      metrics,
      projectCensus: [],
      prompts: [promptRecord('Please use TypeScript strict mode', 'a')],
      projectNames: {}
    })
    expect(once.some((item) => item.key === 'style-strict-ts')).toBe(false)

    const twice = extractMemoryCandidates({
      metrics,
      projectCensus: [],
      prompts: [
        promptRecord('Enable TypeScript strict mode', 'a'),
        promptRecord('Keep strict mode on for this project', 'b')
      ],
      projectNames: {}
    })
    expect(twice.some((item) => item.key === 'style-strict-ts')).toBe(true)
  })
})

describe('rankMemoriesForContext', () => {
  it('skips disabled memories and unrelated project memories', () => {
    const pack = rankMemoriesForContext(
      [
        memory({ id: 'off', content: 'Hidden', enabled: false }),
        memory({ id: 'other', content: 'Other project', scope: 'project', projectId: 'p-other' }),
        memory({ id: 'ok', content: 'Prefers TypeScript', category: 'Languages', projectId: 'p1', scope: 'project' }),
        memory({ id: 'global', content: 'Avoids any', category: 'Coding style' })
      ],
      { projectId: 'p1' },
      true
    )
    expect(pack.memories.map((item) => item.id)).toEqual(['ok', 'global'])
    expect(pack.injectionEnabled).toBe(true)
  })

  it('requires query overlap when a query is provided', () => {
    const pack = rankMemoriesForContext(
      [
        memory({ id: 'ts', content: 'Prefers TypeScript strict mode', category: 'Languages' }),
        memory({ id: 'go', content: 'Uses Go for backend services', category: 'Languages' })
      ],
      { query: 'typescript' },
      false
    )
    expect(pack.memories.map((item) => item.id)).toEqual(['ts'])
    expect(pack.injectionEnabled).toBe(false)
    expect(pack.tokenEstimate).toBeGreaterThan(0)
  })
})
