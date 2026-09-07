import { createHash, randomUUID } from 'crypto'
import { app } from 'electron'
import {
  createDefaultDeveloperIntelligenceSettings,
  type AnalyzeMemoriesResult,
  type ClearTarget,
  type DeveloperEvent,
  type DeveloperEventInput,
  type DeveloperIntelligenceExport,
  type DeveloperIntelligenceSettings,
  type DeveloperIntelligenceStats,
  type DeveloperMemory,
  type DeveloperMetrics,
  type MemoryContextPackage,
  type MemoryContextRequest,
  type MemoryDraft,
  type MemoryUpdate,
  type MetricsRequest,
  type PromptHistoryFilter,
  type PromptHistoryPage,
  type RecordPromptRequest,
  type RecordPromptResponse
} from '@shared/contracts/developer-intelligence'
import {
  getPersistenceDatabase,
  schedulePersistToDisk
} from '../persistence/database'
import {
  classifyWorkCategory,
  detectFrameworkHintsFromPrompt,
  detectLanguageHints,
  languageCensusFromFiles
} from './classification'
import { computeMetrics, resolveMetricsRange, aggregatePromptMetrics, type ProjectCensus } from './metrics'
import { scanProjectLanguages } from './project-scan'
import { redactSecrets } from './redaction'
import { DeveloperIntelligenceStore } from './store'
import { extractMemoryCandidates, rankMemoriesForContext } from './memory-extract'

/**
 * Developer Intelligence service. Owns the store, applies privacy settings and retention,
 * and turns raw inputs from the renderer into persisted history + derived metrics.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CENSUS_PROJECTS = 20
const ANALYSIS_EVENT_THRESHOLD = 12
const ANALYSIS_MIN_EVENTS = 8
const ANALYSIS_COOLDOWN_MS = 10 * 60 * 1000

let store: DeveloperIntelligenceStore | null = null
let cachedSettings: DeveloperIntelligenceSettings | null = null
let analysisTimer: ReturnType<typeof setTimeout> | null = null
let analyzing = false

function getStore(): DeveloperIntelligenceStore | null {
  if (store) return store
  const db = getPersistenceDatabase()
  if (!db) return null
  store = new DeveloperIntelligenceStore({ db, onWrite: () => schedulePersistToDisk() })
  return store
}

export function getDeveloperIntelligenceSettings(): DeveloperIntelligenceSettings {
  if (cachedSettings) return cachedSettings
  const current = getStore()
  cachedSettings = current ? current.getSettings() : createDefaultDeveloperIntelligenceSettings()
  return cachedSettings
}

export function updateDeveloperIntelligenceSettings(
  updates: Partial<DeveloperIntelligenceSettings>
): DeveloperIntelligenceSettings {
  const current = getStore()
  const next = { ...getDeveloperIntelligenceSettings(), ...updates }
  if (!current) {
    cachedSettings = next
    return next
  }
  cachedSettings = current.saveSettings(next)
  applyRetention()
  return cachedSettings
}

export function applyRetention(): { events: number; prompts: number } {
  const current = getStore()
  if (!current) return { events: 0, prompts: 0 }
  const { retentionDays } = getDeveloperIntelligenceSettings()
  if (!retentionDays || retentionDays <= 0) return { events: 0, prompts: 0 }
  const cutoff = Date.now() - retentionDays * DAY_MS
  return {
    events: current.deleteEventsBefore(cutoff),
    prompts: current.deletePromptsBefore(cutoff)
  }
}

export function initDeveloperIntelligence(): void {
  try {
    if (!getStore()) return
    applyRetention()
  } catch (error) {
    console.error('Developer Intelligence init failed:', error)
  }
}

export function recordDeveloperEvent(input: DeveloperEventInput): { ok: true; id: string | null } {
  const current = getStore()
  const settings = getDeveloperIntelligenceSettings()
  if (!current || !settings.keepActivityHistory) return { ok: true, id: null }
  if ((input.type === 'git.commit' || input.type === 'git.file.changed') && !settings.useGitActivity) {
    return { ok: true, id: null }
  }

  const id = randomUUID()
  const occurredAt = input.occurredAt ?? Date.now()

  let event: DeveloperEvent
  if (input.type === 'git.commit') {
    const message = redactSecrets(input.payload.message).text
    event = {
      ...input,
      id,
      occurredAt,
      payload: {
        message,
        fileCount: input.payload.fileCount,
        files: input.payload.files,
        languages: languageCensusFromFiles(input.payload.files),
        ...(message ? { category: classifyWorkCategory(message) } : {})
      }
    }
  } else if (input.type === 'git.file.changed') {
    event = {
      ...input,
      id,
      occurredAt,
      payload: {
        fileCount: input.payload.fileCount,
        files: input.payload.files,
        languages: languageCensusFromFiles(input.payload.files),
        stagedCount: input.payload.stagedCount,
        unstagedCount: input.payload.unstagedCount
      }
    }
  } else {
    event = { ...input, id, occurredAt } as DeveloperEvent
  }

  current.insertEvent(event)
  scheduleLocalAnalysis()
  return { ok: true, id }
}

export function recordPrompt(request: RecordPromptRequest): RecordPromptResponse {
  const current = getStore()
  const settings = getDeveloperIntelligenceSettings()
  const redaction = redactSecrets(request.prompt)
  const category = classifyWorkCategory(redaction.text)
  const languageHints = detectLanguageHints(redaction.text)
  const frameworkHints = detectFrameworkHintsFromPrompt(redaction.text)

  const base = {
    ok: true as const,
    eventId: '',
    ...(category ? { category } : {}),
    languageHints,
    redactedCount: redaction.redactedCount
  }

  if (!current || !settings.keepActivityHistory) return base

  const now = Date.now()
  const eventId = randomUUID()
  const retainText = settings.savePromptHistory

  current.insertEvent({
    id: eventId,
    type: 'prompt.sent',
    occurredAt: now,
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    ...(request.provider ? { provider: request.provider } : {}),
    ...(request.accountId ? { accountId: request.accountId } : {}),
    payload: {
      charCount: request.prompt.length,
      ...(category ? { category } : {}),
      ...(languageHints.length > 0 ? { languageHints } : {}),
      ...(frameworkHints.length > 0 ? { frameworkHints } : {}),
      textRetained: retainText,
      source: request.source
    }
  })

  if (!retainText) {
    scheduleLocalAnalysis()
    return { ...base, eventId }
  }

  const recordId = randomUUID()
  current.insertPrompt({
    id: recordId,
    createdAt: now,
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    ...(request.provider ? { provider: request.provider } : {}),
    ...(request.accountId ? { accountId: request.accountId } : {}),
    prompt: redaction.text,
    promptHash: createHash('sha256').update(redaction.text).digest('hex'),
    source: request.source,
    languageHints,
    ...(category ? { category } : {}),
    redactedCount: redaction.redactedCount
  })

  scheduleLocalAnalysis()
  return { ...base, eventId, recordId }
}

export function listPrompts(filter: PromptHistoryFilter): PromptHistoryPage {
  const current = getStore()
  if (!current) return { items: [], total: 0 }
  return current.listPrompts(filter)
}

export function deletePrompts(ids: string[] | 'all'): { removed: number } {
  const current = getStore()
  if (!current) return { removed: 0 }
  if (ids === 'all') {
    const removed = current.countPrompts()
    current.deleteAllPrompts()
    return { removed }
  }
  return { removed: current.deletePrompts(ids) }
}

export async function getMetrics(request: MetricsRequest): Promise<DeveloperMetrics> {
  const now = Date.now()
  const range = resolveMetricsRange(request.range, now)
  const settings = getDeveloperIntelligenceSettings()
  const current = getStore()

  const span = range.key === 'all' ? 0 : range.to - range.from
  const events = current ? current.listEvents({ from: Math.max(0, range.from - span), to: range.to }) : []

  const projectNames: Record<string, string> = {}
  for (const project of request.projects ?? []) projectNames[project.id] = project.name

  const projectCensus = settings.useProjectFileContext
    ? await collectProjectCensus(request.projects ?? [])
    : []

  const promptFrameworkHints: Record<string, number> = {}
  for (const event of events) {
    if (event.type !== 'prompt.sent' || event.occurredAt < range.from) continue
    for (const hint of event.payload.frameworkHints ?? []) {
      promptFrameworkHints[hint] = (promptFrameworkHints[hint] ?? 0) + 1
    }
  }

  const promptRecords = current
    ? current.listPrompts({ from: range.from, to: range.to, limit: 10_000 }).items
    : []
  const promptAggregates = aggregatePromptMetrics(promptRecords)

  return computeMetrics({
    events,
    range,
    now,
    projectNames,
    projectCensus,
    promptFrameworkHints,
    promptAggregates,
    settings: {
      useGitActivity: settings.useGitActivity,
      useProjectFileContext: settings.useProjectFileContext
    }
  })
}

async function collectProjectCensus(
  projects: Array<{ id: string; name: string; folderPath: string | null }>
): Promise<ProjectCensus[]> {
  const candidates = projects
    .filter((project): project is { id: string; name: string; folderPath: string } => Boolean(project.folderPath))
    .slice(0, MAX_CENSUS_PROJECTS)
  const results = await Promise.all(
    candidates.map(async (project) => {
      try {
        const census = await scanProjectLanguages(project.folderPath)
        return { projectId: project.id, ...census }
      } catch {
        return null
      }
    })
  )
  return results.filter((census): census is ProjectCensus => Boolean(census))
}

export function listMemories(): DeveloperMemory[] {
  const current = getStore()
  return current ? current.listMemories() : []
}

export function createMemory(draft: MemoryDraft): DeveloperMemory | null {
  const current = getStore()
  if (!current) return null
  const now = Date.now()
  const memory: DeveloperMemory = {
    id: randomUUID(),
    scope: draft.scope,
    ...(draft.scope === 'project' && draft.projectId ? { projectId: draft.projectId } : {}),
    category: draft.category,
    content: redactSecrets(draft.content).text,
    confidence: 1,
    evidenceCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    source: 'user',
    enabled: true
  }
  current.upsertMemory(memory)
  return memory
}

export function updateMemory(id: string, updates: MemoryUpdate): DeveloperMemory | null {
  const current = getStore()
  if (!current) return null
  const existing = current.getMemory(id)
  if (!existing) return null
  const scope = updates.scope ?? existing.scope
  const next: DeveloperMemory = {
    ...existing,
    scope,
    category: updates.category ?? existing.category,
    content: updates.content !== undefined ? redactSecrets(updates.content).text : existing.content,
    enabled: updates.enabled ?? existing.enabled,
    lastSeenAt: Date.now()
  }
  const projectId = scope === 'project' ? (updates.projectId ?? existing.projectId) : undefined
  if (projectId) next.projectId = projectId
  else delete next.projectId
  if (updates.content !== undefined && updates.content !== existing.content) next.userEdited = true
  current.upsertMemory(next)
  return next
}

export function deleteMemory(id: string): boolean {
  const current = getStore()
  if (!current) return false
  const existing = current.getMemory(id)
  if (existing?.key) current.dismissMemoryKeys([existing.key])
  return current.deleteMemory(id)
}

export function getStats(): DeveloperIntelligenceStats {
  const current = getStore()
  if (!current) {
    return { eventCount: 0, promptCount: 0, memoryCount: 0, oldestEventAt: null, lastAnalysisAt: null }
  }
  return {
    eventCount: current.countEvents(),
    promptCount: current.countPrompts(),
    memoryCount: current.countMemories(),
    oldestEventAt: current.oldestEventAt(),
    lastAnalysisAt: current.getAnalysisState().lastRunAt
  }
}

export function buildExport(): DeveloperIntelligenceExport {
  const current = getStore()
  return {
    exportedAt: Date.now(),
    appVersion: app.getVersion(),
    settings: getDeveloperIntelligenceSettings(),
    events: current ? current.listEvents() : [],
    prompts: current ? current.listAllPrompts() : [],
    memories: current ? current.listMemories() : []
  }
}

export function clearData(target: ClearTarget): { ok: true } {
  const current = getStore()
  if (!current) return { ok: true }
  switch (target) {
    case 'prompts':
      current.deleteAllPrompts()
      break
    case 'events':
      current.deleteAllEvents()
      break
    case 'memories':
      current.dismissMemoryKeys(
        current
          .listMemories()
          .flatMap((memory) => (memory.key ? [memory.key] : []))
      )
      current.deleteMemories()
      break
    case 'ai-memories':
      current.dismissMemoryKeys(
        current
          .listMemories()
          .filter((memory) => memory.source === 'ai')
          .flatMap((memory) => (memory.key ? [memory.key] : []))
      )
      current.deleteMemories('ai')
      break
    case 'all':
      current.deleteAllEvents()
      current.deleteAllPrompts()
      current.deleteMemories()
      current.saveAnalysisState({ lastRunAt: null, lastEventCount: 0, dismissedKeys: [] })
      cachedSettings = current.saveSettings(createDefaultDeveloperIntelligenceSettings())
      break
  }
  return { ok: true }
}

function memoryIdForKey(key: string): string {
  return `ai-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`
}

function emptyAnalyzeResult(lastRunAt: number): AnalyzeMemoriesResult {
  return { ok: true, mode: 'local', created: 0, updated: 0, skipped: 0, lastRunAt, external: 'unavailable' }
}

export async function analyzeMemories(request: MetricsRequest): Promise<AnalyzeMemoriesResult> {
  const current = getStore()
  const now = Date.now()
  if (!current) return emptyAnalyzeResult(now)
  if (analyzing) return { ...emptyAnalyzeResult(current.getAnalysisState().lastRunAt ?? now) }
  analyzing = true
  try {
    const settings = getDeveloperIntelligenceSettings()
    const metrics = await getMetrics(request)
    const projectNames: Record<string, string> = {}
    for (const project of request.projects ?? []) projectNames[project.id] = project.name
    const projectCensus = settings.useProjectFileContext
      ? await collectProjectCensus(request.projects ?? [])
      : []
    const prompts = settings.savePromptHistory ? current.listPrompts({ limit: 200 }).items : []
    const candidates = extractMemoryCandidates({ metrics, projectCensus, prompts, projectNames })
    const dismissed = new Set(current.getAnalysisState().dismissedKeys)
    let created = 0
    let updated = 0
    let skipped = 0

    for (const item of candidates) {
      if (dismissed.has(item.key)) {
        skipped += 1
        continue
      }
      const existing = current.getMemoryByKey(item.key)
      if (!existing) {
        current.upsertMemory({
          id: memoryIdForKey(item.key),
          scope: item.scope,
          ...(item.projectId ? { projectId: item.projectId } : {}),
          category: item.category,
          content: item.content,
          confidence: item.confidence,
          evidenceCount: item.evidenceCount,
          firstSeenAt: now,
          lastSeenAt: now,
          source: 'ai',
          enabled: true,
          key: item.key
        })
        created += 1
        continue
      }
      const next: DeveloperMemory = {
        ...existing,
        confidence: item.confidence,
        evidenceCount: item.evidenceCount,
        lastSeenAt: now,
        key: item.key,
        source: 'ai'
      }
      if (!existing.userEdited) {
        next.category = item.category
        next.content = item.content
        next.scope = item.scope
        if (item.projectId) next.projectId = item.projectId
        else delete next.projectId
      }
      current.upsertMemory(next)
      updated += 1
    }

    current.saveAnalysisState({
      ...current.getAnalysisState(),
      lastRunAt: now,
      lastEventCount: current.countEvents()
    })
    return { ok: true, mode: 'local', created, updated, skipped, lastRunAt: now, external: 'unavailable' }
  } finally {
    analyzing = false
  }
}

export function getMemoryContext(request: MemoryContextRequest): MemoryContextPackage {
  const current = getStore()
  const settings = getDeveloperIntelligenceSettings()
  return rankMemoriesForContext(current ? current.listMemories() : [], request, settings.includeMemoryInPrompts)
}

function scheduleLocalAnalysis(): void {
  const settings = getDeveloperIntelligenceSettings()
  if (!settings.keepActivityHistory) return
  const current = getStore()
  if (!current) return
  const state = current.getAnalysisState()
  const eventCount = current.countEvents()
  const dueByCount =
    state.lastRunAt === null
      ? eventCount >= ANALYSIS_MIN_EVENTS
      : eventCount - state.lastEventCount >= ANALYSIS_EVENT_THRESHOLD
  const cooledDown = !state.lastRunAt || Date.now() - state.lastRunAt >= ANALYSIS_COOLDOWN_MS
  if (!dueByCount || !cooledDown) return
  if (analysisTimer) return
  analysisTimer = setTimeout(() => {
    analysisTimer = null
    void analyzeMemories({ range: '30d', projects: [] }).catch(() => undefined)
  }, 2500)
}
