import { beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database } from 'sql.js'
import type { DeveloperEvent, PromptRecord } from '@shared/contracts/developer-intelligence'
import { DeveloperIntelligenceStore, normalizeSettings } from '../store'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS di_events (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, occurred_at INTEGER NOT NULL,
    project_id TEXT, session_id TEXT, provider TEXT, account_id TEXT, payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS di_prompts (
    id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, project_id TEXT, session_id TEXT, provider TEXT,
    account_id TEXT, prompt TEXT NOT NULL, prompt_hash TEXT, source TEXT NOT NULL, language_hints_json TEXT,
    category TEXT, input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER, cost_usd REAL,
    cost_source TEXT, redacted_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS di_memories (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_id TEXT, category TEXT NOT NULL, content TEXT NOT NULL,
    confidence REAL NOT NULL, evidence_count INTEGER NOT NULL, first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL, source TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
  );
`

let db: Database
let store: DeveloperIntelligenceStore
const onWrite = vi.fn()

function promptRecord(overrides: Partial<PromptRecord> = {}): PromptRecord {
  return {
    id: `prompt-${Math.random().toString(36).slice(2)}`,
    createdAt: 1_000,
    prompt: 'Add a loading state to the panel',
    source: 'terminal',
    provider: 'claude',
    projectId: 'p1',
    languageHints: ['typescript'],
    category: 'Feature development',
    redactedCount: 0,
    ...overrides
  }
}

beforeEach(async () => {
  const SQL = await initSqlJs()
  db = new SQL.Database()
  db.run(SCHEMA)
  onWrite.mockClear()
  store = new DeveloperIntelligenceStore({ db, onWrite })
})

describe('settings', () => {
  it('falls back to privacy-first defaults', () => {
    expect(store.getSettings()).toMatchObject({
      keepActivityHistory: true,
      savePromptHistory: false,
      analyzePromptsWithAi: false,
      retentionDays: 90
    })
  })

  it('persists and normalizes settings', () => {
    const saved = store.saveSettings({ ...store.getSettings(), savePromptHistory: true, retentionDays: 999 })
    expect(saved.savePromptHistory).toBe(true)
    expect(saved.retentionDays).toBe(90) // invalid retention snaps back to default
    expect(store.getSettings().savePromptHistory).toBe(true)
    expect(onWrite).toHaveBeenCalled()
  })

  it('normalizeSettings ignores garbage', () => {
    expect(normalizeSettings({ keepActivityHistory: 'yes', retentionDays: 30 })).toMatchObject({
      keepActivityHistory: true,
      retentionDays: 30
    })
    expect(normalizeSettings(null).savePromptHistory).toBe(false)
  })
})

describe('events', () => {
  const sample: DeveloperEvent = {
    id: 'e1',
    type: 'agent.session.started',
    occurredAt: 5_000,
    projectId: 'p1',
    sessionId: 's1',
    provider: 'claude',
    payload: { kind: 'claude', launchMode: 'normal' }
  }

  it('round-trips events with typed payloads', () => {
    store.insertEvent(sample)
    store.insertEvent({ ...sample, id: 'e2', occurredAt: 9_000, type: 'task.completed', payload: { taskId: 't', title: 'x', priority: 'low' } })
    const events = store.listEvents()
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual(sample)
    expect(store.listEvents({ from: 6_000 })).toHaveLength(1)
    expect(store.listEvents({ types: ['task.completed'] })[0]?.type).toBe('task.completed')
    expect(store.countEvents()).toBe(2)
    expect(store.oldestEventAt()).toBe(5_000)
  })

  it('applies retention cutoffs', () => {
    store.insertEvent(sample)
    store.insertEvent({ ...sample, id: 'e2', occurredAt: 50_000 })
    expect(store.deleteEventsBefore(10_000)).toBe(1)
    expect(store.listEvents().map((event) => event.id)).toEqual(['e2'])
  })
})

describe('prompts', () => {
  it('filters by provider, project, category, source, date and search', () => {
    store.insertPrompt(promptRecord({ id: 'a', createdAt: 1_000 }))
    store.insertPrompt(promptRecord({ id: 'b', createdAt: 2_000, provider: 'codex', category: 'Debugging', prompt: 'Why does the build fail?' }))
    store.insertPrompt(promptRecord({ id: 'c', createdAt: 3_000, projectId: 'p2', source: 'web-chat', prompt: '100% coverage_please' }))

    expect(store.listPrompts().total).toBe(3)
    expect(store.listPrompts().items.map((item) => item.id)).toEqual(['c', 'b', 'a']) // newest first
    expect(store.listPrompts({ provider: 'codex' }).items.map((item) => item.id)).toEqual(['b'])
    expect(store.listPrompts({ projectId: 'p2' }).total).toBe(1)
    expect(store.listPrompts({ category: 'Debugging' }).total).toBe(1)
    expect(store.listPrompts({ source: 'web-chat' }).total).toBe(1)
    expect(store.listPrompts({ from: 1_500, to: 2_500 }).items.map((item) => item.id)).toEqual(['b'])
    expect(store.listPrompts({ search: 'build' }).total).toBe(1)
    expect(store.listPrompts({ search: '100%' }).total).toBe(1) // LIKE wildcards are escaped
    expect(store.listPrompts({ search: '_please' }).total).toBe(1)
    expect(store.listPrompts({ limit: 1, offset: 1 }).items.map((item) => item.id)).toEqual(['b'])
  })

  it('round-trips optional fields', () => {
    store.insertPrompt(promptRecord({ id: 'x', promptHash: 'abc', inputTokenCount: 10, costUsd: 0.5, costSource: 'official', redactedCount: 2 }))
    const [record] = store.listPrompts().items
    expect(record).toMatchObject({ promptHash: 'abc', inputTokenCount: 10, costUsd: 0.5, costSource: 'official', redactedCount: 2 })
  })

  it('deletes by id list and by cutoff', () => {
    store.insertPrompt(promptRecord({ id: 'a', createdAt: 1_000 }))
    store.insertPrompt(promptRecord({ id: 'b', createdAt: 2_000 }))
    store.insertPrompt(promptRecord({ id: 'c', createdAt: 3_000 }))
    expect(store.deletePrompts(['a', 'missing'])).toBe(1)
    expect(store.deletePromptsBefore(2_500)).toBe(1)
    expect(store.listPrompts().items.map((item) => item.id)).toEqual(['c'])
    store.deleteAllPrompts()
    expect(store.countPrompts()).toBe(0)
  })
})

describe('memories', () => {
  it('upserts, toggles and deletes memories by source', () => {
    store.upsertMemory({
      id: 'm1', scope: 'global', category: 'Coding style', content: 'Prefers strict mode',
      confidence: 1, evidenceCount: 1, firstSeenAt: 1, lastSeenAt: 1, source: 'user', enabled: true
    })
    store.upsertMemory({
      id: 'm2', scope: 'project', projectId: 'p1', category: 'Workflow', content: 'Plans before implementing',
      confidence: 0.7, evidenceCount: 4, firstSeenAt: 1, lastSeenAt: 2, source: 'ai', enabled: true
    })
    expect(store.listMemories().map((memory) => memory.id)).toEqual(['m2', 'm1'])

    const m2 = store.getMemory('m2')
    expect(m2).toMatchObject({ scope: 'project', projectId: 'p1', confidence: 0.7, evidenceCount: 4 })
    store.upsertMemory({ ...m2!, enabled: false })
    expect(store.getMemory('m2')?.enabled).toBe(false)

    expect(store.deleteMemories('ai')).toBe(1)
    expect(store.listMemories().map((memory) => memory.id)).toEqual(['m1'])
    expect(store.deleteMemory('m1')).toBe(true)
    expect(store.deleteMemory('m1')).toBe(false)
    expect(store.countMemories()).toBe(0)
  })

  it('round-trips extraction keys and analysis state', () => {
    store.upsertMemory({
      id: 'ai-1',
      scope: 'global',
      category: 'Languages',
      content: 'Primarily works in TypeScript.',
      confidence: 0.8,
      evidenceCount: 5,
      firstSeenAt: 1,
      lastSeenAt: 2,
      source: 'ai',
      enabled: true,
      key: 'language-primary'
    })
    expect(store.getMemoryByKey('language-primary')?.id).toBe('ai-1')
    store.saveAnalysisState({ lastRunAt: 10, lastEventCount: 4, dismissedKeys: ['language-primary'] })
    expect(store.getAnalysisState()).toEqual({
      lastRunAt: 10,
      lastEventCount: 4,
      dismissedKeys: ['language-primary']
    })
    store.dismissMemoryKeys(['agent-primary'])
    expect(store.getAnalysisState().dismissedKeys).toEqual(['language-primary', 'agent-primary'])
  })
})
