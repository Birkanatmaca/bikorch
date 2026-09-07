import type { Database, SqlValue } from 'sql.js'
import {
  createDefaultDeveloperIntelligenceSettings,
  DEVELOPER_EVENT_TYPES,
  PROMPT_SOURCES,
  RETENTION_OPTIONS,
  WORK_CATEGORIES,
  type DeveloperEvent,
  type DeveloperEventType,
  type DeveloperIntelligenceSettings,
  type DeveloperMemory,
  type MemoryScope,
  type PromptHistoryFilter,
  type PromptHistoryPage,
  type PromptRecord,
  type PromptSource,
  type WorkCategory
} from '@shared/contracts/developer-intelligence'

/**
 * Thin SQL access layer for Developer Intelligence tables. Takes a sql.js Database so it
 * can be exercised in tests without Electron.
 */

const SETTINGS_META_KEY = 'developer_intelligence_settings'
const ANALYSIS_META_KEY = 'developer_intelligence_analysis'
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 500

export interface AnalysisState {
  lastRunAt: number | null
  lastEventCount: number
  dismissedKeys: string[]
}

function emptyAnalysisState(): AnalysisState {
  return { lastRunAt: null, lastEventCount: 0, dismissedKeys: [] }
}

function tableColumnNames(db: Database, table: string): string[] {
  return rows(db, `PRAGMA table_info(${table})`).flatMap((row) => {
    const name = text(row['name'])
    return name ? [name] : []
  })
}

function ensureMemorySchema(db: Database): boolean {
  const columns = new Set(tableColumnNames(db, 'di_memories'))
  if (columns.size === 0) return false
  let changed = false
  if (!columns.has('memory_key')) {
    db.run('ALTER TABLE di_memories ADD COLUMN memory_key TEXT')
    changed = true
  }
  if (!columns.has('user_edited')) {
    db.run('ALTER TABLE di_memories ADD COLUMN user_edited INTEGER NOT NULL DEFAULT 0')
    changed = true
  }
  db.run('CREATE INDEX IF NOT EXISTS di_memories_key ON di_memories (memory_key)')
  return changed
}

export interface StoreOptions {
  db: Database
  /** Called after every write so the owner can flush to disk. */
  onWrite: () => void
}

type Row = Record<string, SqlValue>

function rows(db: Database, sql: string, params: SqlValue[] = []): Row[] {
  const statement = db.prepare(sql)
  try {
    statement.bind(params)
    const result: Row[] = []
    while (statement.step()) result.push(statement.getAsObject() as Row)
    return result
  } finally {
    statement.free()
  }
}

function scalar<T extends SqlValue>(db: Database, sql: string, params: SqlValue[] = []): T | null {
  const result = rows(db, sql, params)
  const first = result[0]
  if (!first) return null
  const value = Object.values(first)[0]
  return (value ?? null) as T | null
}

function text(value: SqlValue): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function integer(value: SqlValue): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseJson<T>(value: SqlValue, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function rowToEvent(row: Row): DeveloperEvent | null {
  const type = row['type']
  if (typeof type !== 'string' || !DEVELOPER_EVENT_TYPES.includes(type as DeveloperEventType)) return null
  const occurredAt = integer(row['occurred_at'])
  const id = text(row['id'])
  if (!id || occurredAt === undefined) return null
  const payload = parseJson<Record<string, unknown> | null>(row['payload_json'], null)
  if (!payload) return null
  const event: Record<string, unknown> = {
    id,
    type,
    occurredAt,
    ...(text(row['project_id']) ? { projectId: text(row['project_id']) } : {}),
    ...(text(row['session_id']) ? { sessionId: text(row['session_id']) } : {}),
    ...(text(row['provider']) ? { provider: text(row['provider']) } : {}),
    ...(text(row['account_id']) ? { accountId: text(row['account_id']) } : {}),
    payload
  }
  // Payload shapes were validated on insert; stored rows are trusted.
  return event as unknown as DeveloperEvent
}

function rowToPrompt(row: Row): PromptRecord | null {
  const id = text(row['id'])
  const createdAt = integer(row['created_at'])
  const prompt = typeof row['prompt'] === 'string' ? row['prompt'] : null
  const source = text(row['source'])
  if (!id || createdAt === undefined || prompt === null || !source) return null
  const category = text(row['category'])
  const costSource = text(row['cost_source'])
  return {
    id,
    createdAt,
    ...(text(row['project_id']) ? { projectId: text(row['project_id']) } : {}),
    ...(text(row['session_id']) ? { sessionId: text(row['session_id']) } : {}),
    ...(text(row['provider']) ? { provider: text(row['provider']) } : {}),
    ...(text(row['account_id']) ? { accountId: text(row['account_id']) } : {}),
    prompt,
    ...(text(row['prompt_hash']) ? { promptHash: text(row['prompt_hash']) } : {}),
    source: PROMPT_SOURCES.includes(source as PromptSource) ? (source as PromptSource) : 'other',
    languageHints: parseJson<string[]>(row['language_hints_json'], []),
    ...(category && WORK_CATEGORIES.includes(category as WorkCategory)
      ? { category: category as WorkCategory }
      : {}),
    ...(integer(row['input_tokens']) !== undefined ? { inputTokenCount: integer(row['input_tokens']) } : {}),
    ...(integer(row['output_tokens']) !== undefined ? { outputTokenCount: integer(row['output_tokens']) } : {}),
    ...(integer(row['cached_tokens']) !== undefined ? { cachedTokenCount: integer(row['cached_tokens']) } : {}),
    ...(integer(row['cost_usd']) !== undefined ? { costUsd: integer(row['cost_usd']) } : {}),
    ...(costSource === 'official' || costSource === 'estimated' ? { costSource } : {}),
    redactedCount: integer(row['redacted_count']) ?? 0
  }
}

function rowToMemory(row: Row): DeveloperMemory | null {
  const id = text(row['id'])
  const scope = text(row['scope'])
  const content = typeof row['content'] === 'string' ? row['content'] : null
  if (!id || (scope !== 'global' && scope !== 'project') || content === null) return null
  const source = row['source'] === 'ai' ? 'ai' : 'user'
  return {
    id,
    scope: scope as MemoryScope,
    ...(text(row['project_id']) ? { projectId: text(row['project_id']) } : {}),
    category: text(row['category']) ?? 'Other',
    content,
    confidence: integer(row['confidence']) ?? 1,
    evidenceCount: integer(row['evidence_count']) ?? 1,
    firstSeenAt: integer(row['first_seen_at']) ?? 0,
    lastSeenAt: integer(row['last_seen_at']) ?? 0,
    source,
    enabled: row['enabled'] !== 0,
    ...(text(row['memory_key']) ? { key: text(row['memory_key']) } : {}),
    ...(row['user_edited'] === 1 ? { userEdited: true } : {})
  }
}

export function normalizeSettings(raw: unknown): DeveloperIntelligenceSettings {
  const defaults = createDefaultDeveloperIntelligenceSettings()
  if (!raw || typeof raw !== 'object') return defaults
  const candidate = raw as Partial<DeveloperIntelligenceSettings>
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback
  const retention = RETENTION_OPTIONS.includes(candidate.retentionDays as (typeof RETENTION_OPTIONS)[number])
    ? (candidate.retentionDays as number)
    : defaults.retentionDays
  return {
    keepActivityHistory: bool(candidate.keepActivityHistory, defaults.keepActivityHistory),
    savePromptHistory: bool(candidate.savePromptHistory, defaults.savePromptHistory),
    analyzePromptsWithAi: bool(candidate.analyzePromptsWithAi, defaults.analyzePromptsWithAi),
    useProjectFileContext: bool(candidate.useProjectFileContext, defaults.useProjectFileContext),
    useGitActivity: bool(candidate.useGitActivity, defaults.useGitActivity),
    includeMemoryInPrompts: bool(candidate.includeMemoryInPrompts, defaults.includeMemoryInPrompts),
    retentionDays: retention
  }
}

export class DeveloperIntelligenceStore {
  private readonly db: Database
  private readonly onWrite: () => void

  constructor(options: StoreOptions) {
    this.db = options.db
    this.onWrite = options.onWrite
    if (ensureMemorySchema(this.db)) this.onWrite()
  }

  // --- Settings ------------------------------------------------------------

  getSettings(): DeveloperIntelligenceSettings {
    const raw = scalar<string>(this.db, 'SELECT value FROM meta WHERE key = ?', [SETTINGS_META_KEY])
    return normalizeSettings(raw ? parseJson<unknown>(raw, null) : null)
  }

  saveSettings(settings: DeveloperIntelligenceSettings): DeveloperIntelligenceSettings {
    const normalized = normalizeSettings(settings)
    this.db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      SETTINGS_META_KEY,
      JSON.stringify(normalized)
    ])
    this.onWrite()
    return normalized
  }

  getAnalysisState(): AnalysisState {
    const raw = scalar<string>(this.db, 'SELECT value FROM meta WHERE key = ?', [ANALYSIS_META_KEY])
    if (!raw) return emptyAnalysisState()
    const parsed = parseJson<Partial<AnalysisState> | null>(raw, null)
    if (!parsed || typeof parsed !== 'object') return emptyAnalysisState()
    const dismissed = Array.isArray(parsed.dismissedKeys)
      ? parsed.dismissedKeys.filter(
          (key): key is string => typeof key === 'string' && key.length > 0 && key.length < 200
        )
      : []
    return {
      lastRunAt: typeof parsed.lastRunAt === 'number' && parsed.lastRunAt > 0 ? parsed.lastRunAt : null,
      lastEventCount:
        typeof parsed.lastEventCount === 'number' && Number.isFinite(parsed.lastEventCount)
          ? Math.max(0, Math.floor(parsed.lastEventCount))
          : 0,
      dismissedKeys: [...new Set(dismissed)].slice(0, 500)
    }
  }

  saveAnalysisState(state: AnalysisState): AnalysisState {
    const normalized: AnalysisState = {
      lastRunAt: state.lastRunAt && state.lastRunAt > 0 ? state.lastRunAt : null,
      lastEventCount: Math.max(0, Math.floor(state.lastEventCount)),
      dismissedKeys: [...new Set(state.dismissedKeys.filter((key) => key.length > 0 && key.length < 200))].slice(
        0,
        500
      )
    }
    this.db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      ANALYSIS_META_KEY,
      JSON.stringify(normalized)
    ])
    this.onWrite()
    return normalized
  }

  dismissMemoryKeys(keys: string[]): AnalysisState {
    const current = this.getAnalysisState()
    if (keys.length === 0) return current
    return this.saveAnalysisState({
      ...current,
      dismissedKeys: [...current.dismissedKeys, ...keys]
    })
  }

  // --- Events --------------------------------------------------------------

  insertEvent(event: DeveloperEvent): void {
    this.db.run(
      `INSERT OR REPLACE INTO di_events
        (id, type, occurred_at, project_id, session_id, provider, account_id, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.type,
        event.occurredAt,
        event.projectId ?? null,
        event.sessionId ?? null,
        event.provider ?? null,
        event.accountId ?? null,
        JSON.stringify(event.payload)
      ]
    )
    this.onWrite()
  }

  listEvents(options: { from?: number; to?: number; types?: DeveloperEventType[]; limit?: number } = {}): DeveloperEvent[] {
    const clauses: string[] = []
    const params: SqlValue[] = []
    if (options.from !== undefined) {
      clauses.push('occurred_at >= ?')
      params.push(options.from)
    }
    if (options.to !== undefined) {
      clauses.push('occurred_at <= ?')
      params.push(options.to)
    }
    if (options.types && options.types.length > 0) {
      clauses.push(`type IN (${options.types.map(() => '?').join(', ')})`)
      params.push(...options.types)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const limit = options.limit ? `LIMIT ${Math.max(1, Math.floor(options.limit))}` : ''
    return rows(
      this.db,
      `SELECT * FROM di_events ${where} ORDER BY occurred_at ASC ${limit}`,
      params
    ).flatMap((row) => {
      const event = rowToEvent(row)
      return event ? [event] : []
    })
  }

  countEvents(): number {
    return scalar<number>(this.db, 'SELECT COUNT(*) AS count FROM di_events') ?? 0
  }

  oldestEventAt(): number | null {
    return scalar<number>(this.db, 'SELECT MIN(occurred_at) AS oldest FROM di_events')
  }

  deleteEventsBefore(cutoff: number): number {
    this.db.run('DELETE FROM di_events WHERE occurred_at < ?', [cutoff])
    const removed = this.db.getRowsModified()
    if (removed > 0) this.onWrite()
    return removed
  }

  deleteAllEvents(): void {
    this.db.run('DELETE FROM di_events')
    this.onWrite()
  }

  // --- Prompts -------------------------------------------------------------

  insertPrompt(record: PromptRecord): void {
    this.db.run(
      `INSERT OR REPLACE INTO di_prompts
        (id, created_at, project_id, session_id, provider, account_id, prompt, prompt_hash, source,
         language_hints_json, category, input_tokens, output_tokens, cached_tokens, cost_usd, cost_source,
         redacted_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.createdAt,
        record.projectId ?? null,
        record.sessionId ?? null,
        record.provider ?? null,
        record.accountId ?? null,
        record.prompt,
        record.promptHash ?? null,
        record.source,
        JSON.stringify(record.languageHints ?? []),
        record.category ?? null,
        record.inputTokenCount ?? null,
        record.outputTokenCount ?? null,
        record.cachedTokenCount ?? null,
        record.costUsd ?? null,
        record.costSource ?? null,
        record.redactedCount
      ]
    )
    this.onWrite()
  }

  listPrompts(filter: PromptHistoryFilter = {}): PromptHistoryPage {
    const clauses: string[] = []
    const params: SqlValue[] = []
    if (filter.provider) {
      clauses.push('provider = ?')
      params.push(filter.provider)
    }
    if (filter.projectId) {
      clauses.push('project_id = ?')
      params.push(filter.projectId)
    }
    if (filter.category) {
      clauses.push('category = ?')
      params.push(filter.category)
    }
    if (filter.source) {
      clauses.push('source = ?')
      params.push(filter.source)
    }
    if (filter.from !== undefined) {
      clauses.push('created_at >= ?')
      params.push(filter.from)
    }
    if (filter.to !== undefined) {
      clauses.push('created_at <= ?')
      params.push(filter.to)
    }
    if (filter.search && filter.search.trim()) {
      clauses.push("prompt LIKE ? ESCAPE '\\'")
      params.push(`%${escapeLike(filter.search.trim())}%`)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const total = scalar<number>(this.db, `SELECT COUNT(*) AS count FROM di_prompts ${where}`, params) ?? 0
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(filter.limit ?? DEFAULT_PAGE_SIZE)))
    const offset = Math.max(0, Math.floor(filter.offset ?? 0))
    const items = rows(
      this.db,
      `SELECT * FROM di_prompts ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    ).flatMap((row) => {
      const record = rowToPrompt(row)
      return record ? [record] : []
    })
    return { items, total }
  }

  listAllPrompts(): PromptRecord[] {
    return rows(this.db, 'SELECT * FROM di_prompts ORDER BY created_at ASC').flatMap((row) => {
      const record = rowToPrompt(row)
      return record ? [record] : []
    })
  }

  countPrompts(): number {
    return scalar<number>(this.db, 'SELECT COUNT(*) AS count FROM di_prompts') ?? 0
  }

  deletePrompts(ids: string[]): number {
    if (ids.length === 0) return 0
    let removed = 0
    for (let index = 0; index < ids.length; index += 200) {
      const chunk = ids.slice(index, index + 200)
      this.db.run(`DELETE FROM di_prompts WHERE id IN (${chunk.map(() => '?').join(', ')})`, chunk)
      removed += this.db.getRowsModified()
    }
    if (removed > 0) this.onWrite()
    return removed
  }

  deletePromptsBefore(cutoff: number): number {
    this.db.run('DELETE FROM di_prompts WHERE created_at < ?', [cutoff])
    const removed = this.db.getRowsModified()
    if (removed > 0) this.onWrite()
    return removed
  }

  deleteAllPrompts(): void {
    this.db.run('DELETE FROM di_prompts')
    this.onWrite()
  }

  // --- Memories ------------------------------------------------------------

  listMemories(): DeveloperMemory[] {
    return rows(this.db, 'SELECT * FROM di_memories ORDER BY last_seen_at DESC').flatMap((row) => {
      const memory = rowToMemory(row)
      return memory ? [memory] : []
    })
  }

  getMemory(id: string): DeveloperMemory | null {
    const row = rows(this.db, 'SELECT * FROM di_memories WHERE id = ?', [id])[0]
    return row ? rowToMemory(row) : null
  }

  getMemoryByKey(key: string): DeveloperMemory | null {
    const row = rows(this.db, 'SELECT * FROM di_memories WHERE memory_key = ? LIMIT 1', [key])[0]
    return row ? rowToMemory(row) : null
  }

  upsertMemory(memory: DeveloperMemory): void {
    this.db.run(
      `INSERT OR REPLACE INTO di_memories
        (id, scope, project_id, category, content, confidence, evidence_count, first_seen_at, last_seen_at, source, enabled, memory_key, user_edited)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        memory.id,
        memory.scope,
        memory.projectId ?? null,
        memory.category,
        memory.content,
        memory.confidence,
        memory.evidenceCount,
        memory.firstSeenAt,
        memory.lastSeenAt,
        memory.source,
        memory.enabled ? 1 : 0,
        memory.key ?? null,
        memory.userEdited ? 1 : 0
      ]
    )
    this.onWrite()
  }

  deleteMemory(id: string): boolean {
    this.db.run('DELETE FROM di_memories WHERE id = ?', [id])
    const removed = this.db.getRowsModified() > 0
    if (removed) this.onWrite()
    return removed
  }

  deleteMemories(source?: 'ai' | 'user'): number {
    if (source) this.db.run('DELETE FROM di_memories WHERE source = ?', [source])
    else this.db.run('DELETE FROM di_memories')
    const removed = this.db.getRowsModified()
    if (removed > 0) this.onWrite()
    return removed
  }

  countMemories(): number {
    return scalar<number>(this.db, 'SELECT COUNT(*) AS count FROM di_memories') ?? 0
  }
}
