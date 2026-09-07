import { describe, expect, it } from 'vitest'
import {
  parseClearTarget,
  parseContextRequest,
  parseEventInput,
  parseIdList,
  parseMemoryDraft,
  parseMemoryUpdate,
  parseMetricsRequest,
  parsePromptFilter,
  parsePromptRequest,
  parseSettingsUpdate
} from '../validation'

describe('parseEventInput', () => {
  it('rejects unknown types and prompt events (which must use the prompt endpoint)', () => {
    expect(parseEventInput({ type: 'nope', payload: {} })).toBeNull()
    expect(parseEventInput({ type: 'prompt.sent', payload: { charCount: 1 } })).toBeNull()
    expect(parseEventInput(null)).toBeNull()
  })

  it('accepts well-formed session events and drops junk fields', () => {
    const parsed = parseEventInput({
      type: 'agent.session.ended',
      sessionId: 's1',
      projectId: 'p1',
      provider: 'claude',
      occurredAt: 123,
      extra: 'ignored',
      payload: { kind: 'claude', durationMs: 1234.7, promptCount: 2.2, exitCode: 0 }
    })
    expect(parsed).toEqual({
      type: 'agent.session.ended',
      sessionId: 's1',
      projectId: 'p1',
      provider: 'claude',
      occurredAt: 123,
      payload: { kind: 'claude', durationMs: 1234, promptCount: 2, exitCode: 0 }
    })
    expect(parseEventInput({ type: 'agent.session.ended', payload: { kind: 'claude', durationMs: -1 } })).toBeNull()
    expect(parseEventInput({ type: 'agent.session.started', payload: { kind: 'unknown-cli' } })).toBeNull()
  })

  it('caps git commit file lists and leaves language census to the service', () => {
    const files = Array.from({ length: 300 }, (_, index) => `file-${index}.ts`)
    const parsed = parseEventInput({ type: 'git.commit', projectId: 'p1', payload: { message: 'x', files, fileCount: 300 } })
    expect(parsed?.type).toBe('git.commit')
    if (parsed?.type === 'git.commit') {
      expect(parsed.payload.files).toHaveLength(200)
      expect(parsed.payload.fileCount).toBe(300)
      expect(parsed.payload.languages).toEqual({})
    }
  })

  it('accepts git file change and usage snapshot events', () => {
    const fileChange = parseEventInput({
      type: 'git.file.changed',
      projectId: 'p1',
      payload: { files: ['a.ts'], fileCount: 1, stagedCount: 1, unstagedCount: 0 }
    })
    expect(fileChange?.type).toBe('git.file.changed')

    const usage = parseEventInput({
      type: 'usage.snapshot',
      provider: 'claude',
      accountId: 'acc1',
      payload: { kind: 'claude', primaryUsedPercent: 42.5, planType: 'Pro' }
    })
    expect(usage).toMatchObject({
      type: 'usage.snapshot',
      provider: 'claude',
      accountId: 'acc1',
      payload: { kind: 'claude', primaryUsedPercent: 42.5, planType: 'Pro' }
    })
    expect(parseEventInput({ type: 'usage.snapshot', payload: { kind: 'claude', primaryUsedPercent: 200 } })).toMatchObject({
      payload: { primaryUsedPercent: 100 }
    })
  })

  it('validates task payloads', () => {
    expect(parseEventInput({ type: 'task.completed', payload: { taskId: 't', title: 'Do it', priority: 'high' } })).toMatchObject({
      type: 'task.completed'
    })
    expect(parseEventInput({ type: 'task.started', payload: { taskId: 't', title: '', priority: 'high' } })).toBeNull()
    expect(parseEventInput({ type: 'task.started', payload: { taskId: 't', title: 'x', priority: 'urgent' } })).toBeNull()
  })
})

describe('parsePromptRequest', () => {
  it('requires text and a known source', () => {
    expect(parsePromptRequest({ prompt: '  ', source: 'terminal' })).toBeNull()
    expect(parsePromptRequest({ prompt: 'hi', source: 'email' })).toBeNull()
    expect(parsePromptRequest({ prompt: 'hi', source: 'terminal', provider: 'claude' })).toEqual({
      prompt: 'hi',
      source: 'terminal',
      provider: 'claude'
    })
  })

  it('truncates oversized prompts', () => {
    const parsed = parsePromptRequest({ prompt: 'a'.repeat(30_000), source: 'other' })
    expect(parsed?.prompt).toHaveLength(20_000)
  })
})

describe('parsePromptFilter', () => {
  it('keeps only known filter keys', () => {
    expect(parsePromptFilter({ provider: 'claude', category: 'Nope', source: 'terminal', search: '  x ', limit: 10, bogus: 1 })).toEqual({
      provider: 'claude',
      source: 'terminal',
      search: 'x',
      limit: 10
    })
    expect(parsePromptFilter(undefined)).toEqual({})
  })
})

describe('parseIdList', () => {
  it('accepts "all" or a clean list of ids', () => {
    expect(parseIdList('all')).toBe('all')
    expect(parseIdList(['a', 'b'])).toEqual(['a', 'b'])
    expect(parseIdList(['a', 1])).toBeNull()
    expect(parseIdList('some')).toBeNull()
  })
})

describe('parseMetricsRequest', () => {
  it('validates range and sanitizes projects', () => {
    expect(parseMetricsRequest({ range: 'yesterday' })).toBeNull()
    expect(
      parseMetricsRequest({ range: '7d', projects: [{ id: 'p1', name: 'A', folderPath: '/tmp/a' }, { id: '', name: 'B' }] })
    ).toEqual({ range: '7d', projects: [{ id: 'p1', name: 'A', folderPath: '/tmp/a' }] })
  })
})

describe('memory parsing', () => {
  it('requires content and a project for project scope', () => {
    expect(parseMemoryDraft({ scope: 'project', content: 'x' })).toBeNull()
    expect(parseMemoryDraft({ scope: 'global', content: '  Prefers tabs ' })).toEqual({
      scope: 'global',
      category: 'Other',
      content: 'Prefers tabs'
    })
    expect(parseMemoryUpdate({ id: 'm', updates: { enabled: false, content: '' } })).toBeNull()
    expect(parseMemoryUpdate({ id: 'm', updates: { enabled: false } })).toEqual({ id: 'm', updates: { enabled: false } })
  })
})

describe('settings and clear targets', () => {
  it('extracts only boolean toggles and numeric retention', () => {
    expect(parseSettingsUpdate({ savePromptHistory: true, retentionDays: 30, keepActivityHistory: 'no' })).toEqual({
      savePromptHistory: true,
      retentionDays: 30
    })
    expect(parseSettingsUpdate('x')).toBeNull()
  })

  it('accepts only known clear targets', () => {
    expect(parseClearTarget('all')).toBe('all')
    expect(parseClearTarget('ai-memories')).toBe('ai-memories')
    expect(parseClearTarget('everything')).toBeNull()
  })
})

describe('parseContextRequest', () => {
  it('accepts empty payloads and caps limit/query', () => {
    expect(parseContextRequest(undefined)).toEqual({})
    expect(parseContextRequest({ projectId: 'p1', query: '  React  ', limit: 99, extra: 1 })).toEqual({
      projectId: 'p1',
      query: 'React',
      limit: 20
    })
    expect(parseContextRequest('nope')).toBeNull()
  })
})
