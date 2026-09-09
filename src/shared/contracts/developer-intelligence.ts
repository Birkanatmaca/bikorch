import type { CliUsageKind } from './usage'

/**
 * Developer Intelligence keeps three clearly separated concepts:
 *
 * 1. History  — raw/structured activity records (DeveloperEvent, PromptRecord)
 * 2. Metrics  — statistics derived from history (DeveloperMetrics)
 * 3. Memory   — semantic facts/preferences (DeveloperMemory)
 *
 * Nothing in this module leaves the machine unless the user explicitly opts in.
 */

// ---------------------------------------------------------------------------
// Activity events
// ---------------------------------------------------------------------------

export type DeveloperEventType =
  | 'prompt.sent'
  | 'agent.session.started'
  | 'agent.session.ended'
  | 'git.commit'
  | 'git.file.changed'
  | 'project.opened'
  | 'usage.snapshot'
  | 'task.started'
  | 'task.completed'

export type PromptSource = 'terminal' | 'web-chat' | 'handoff' | 'other'

export const WORK_CATEGORIES = [
  'Feature development',
  'Debugging',
  'Refactoring',
  'Testing',
  'Architecture',
  'DevOps',
  'Documentation',
  'Research',
  'Code review'
] as const

export type WorkCategory = (typeof WORK_CATEGORIES)[number]

export interface PromptSentPayload {
  /** Character count of the prompt (always available, even when text retention is off). */
  charCount: number
  /** Heuristic work category derived locally. */
  category?: WorkCategory
  /** Language hints extracted from code fences / file names in the prompt. */
  languageHints?: string[]
  /** Framework/technology names mentioned in the prompt (weak evidence). */
  frameworkHints?: string[]
  /** Whether the prompt text was persisted in the prompt history table. */
  textRetained: boolean
  source: PromptSource
}

export interface SessionStartedPayload {
  kind: CliUsageKind | 'terminal'
  launchMode?: 'normal' | 'login'
}

export interface SessionEndedPayload {
  kind: CliUsageKind | 'terminal'
  durationMs: number
  promptCount: number
  exitCode: number | null
}

export interface GitCommitPayload {
  /** Commit message with secrets redacted. */
  message: string
  fileCount: number
  /** Repo-relative file paths (capped). */
  files: string[]
  /** Language census of the committed files, derived from file extensions. */
  languages: Record<string, number>
  category?: WorkCategory
}

export interface GitFileChangedPayload {
  fileCount: number
  /** Repo-relative file paths (capped). */
  files: string[]
  /** Language census derived from file extensions in the main process. */
  languages: Record<string, number>
  stagedCount: number
  unstagedCount: number
}

export interface UsageSnapshotPayload {
  kind: CliUsageKind
  primaryUsedPercent: number | null
  secondaryUsedPercent?: number | null
  planType?: string | null
}

export interface ProjectOpenedPayload {
  name: string
  folderPath: string | null
}

export interface TaskPayload {
  taskId: string
  title: string
  priority: 'low' | 'medium' | 'high'
}

export interface DeveloperEventPayloadMap {
  'prompt.sent': PromptSentPayload
  'agent.session.started': SessionStartedPayload
  'agent.session.ended': SessionEndedPayload
  'git.commit': GitCommitPayload
  'git.file.changed': GitFileChangedPayload
  'project.opened': ProjectOpenedPayload
  'usage.snapshot': UsageSnapshotPayload
  'task.started': TaskPayload
  'task.completed': TaskPayload
}

export interface DeveloperEventBase<T extends DeveloperEventType> {
  id: string
  type: T
  occurredAt: number
  projectId?: string
  sessionId?: string
  provider?: string
  accountId?: string
  payload: DeveloperEventPayloadMap[T]
}

export type DeveloperEvent = {
  [T in DeveloperEventType]: DeveloperEventBase<T>
}[DeveloperEventType]

/** Input accepted from the renderer — ids/timestamps are assigned by the main process. */
export type DeveloperEventInput = {
  [T in DeveloperEventType]: Omit<DeveloperEventBase<T>, 'id' | 'occurredAt'> & {
    occurredAt?: number
  }
}[DeveloperEventType]

// ---------------------------------------------------------------------------
// Prompt history
// ---------------------------------------------------------------------------

export interface PromptRecord {
  id: string
  createdAt: number
  projectId?: string
  sessionId?: string
  provider?: string
  accountId?: string
  /** Prompt text after secret redaction. */
  prompt: string
  promptHash?: string
  source: PromptSource
  languageHints?: string[]
  category?: WorkCategory
  inputTokenCount?: number
  outputTokenCount?: number
  cachedTokenCount?: number
  costUsd?: number
  costSource?: 'official' | 'estimated'
  /** Number of secret-looking fragments that were redacted before storage. */
  redactedCount: number
}

export interface RecordPromptRequest {
  prompt: string
  source: PromptSource
  projectId?: string
  sessionId?: string
  provider?: string
  accountId?: string
}

export interface RecordPromptResponse {
  ok: true
  /** Present only when prompt text retention is enabled. */
  recordId?: string
  eventId: string
  category?: WorkCategory
  languageHints: string[]
  redactedCount: number
}

export interface PromptHistoryFilter {
  provider?: string
  projectId?: string
  category?: WorkCategory
  source?: PromptSource
  from?: number
  to?: number
  search?: string
  limit?: number
  offset?: number
}

export interface PromptHistoryPage {
  items: PromptRecord[]
  total: number
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export type MemoryScope = 'global' | 'project'

export interface DeveloperMemory {
  id: string
  scope: MemoryScope
  projectId?: string
  category: string
  content: string
  confidence: number
  evidenceCount: number
  firstSeenAt: number
  lastSeenAt: number
  source: 'ai' | 'user'
  enabled: boolean
  /** Stable extraction key so heuristic memories can be upserted instead of duplicated. */
  key?: string
  /** When true, later extraction updates evidence only and leaves `content` alone. */
  userEdited?: boolean
}

export interface MemoryDraft {
  scope: MemoryScope
  projectId?: string
  category: string
  content: string
}

export type MemoryUpdate = Partial<
  Pick<DeveloperMemory, 'scope' | 'projectId' | 'category' | 'content' | 'enabled'>
>

export interface MemoryCandidate {
  key: string
  scope: MemoryScope
  projectId?: string
  category: string
  content: string
  confidence: number
  evidenceCount: number
}

export interface MemoryContextRequest {
  projectId?: string
  query?: string
  limit?: number
}

export interface MemoryContextItem {
  id: string
  scope: MemoryScope
  category: string
  content: string
  relevance: number
}

export interface MemoryContextPackage {
  memories: MemoryContextItem[]
  characterCount: number
  tokenEstimate: number
  truncated: boolean
  injectionEnabled: boolean
}

export interface AnalyzeMemoriesResult {
  ok: true
  mode: 'local'
  created: number
  updated: number
  skipped: number
  lastRunAt: number
  /** External model analysis is never silent; this build has no configured provider. */
  external: 'unavailable'
}

export interface MetricInterpretation {
  text: string
  basis: string
}

export const MEMORY_CATEGORIES = [
  'Coding style',
  'Tooling',
  'Workflow',
  'Languages',
  'Architecture',
  'Communication',
  'Other'
] as const

// ---------------------------------------------------------------------------
// Privacy settings
// ---------------------------------------------------------------------------

export interface DeveloperIntelligenceSettings {
  /** Keep non-content activity events (sessions, commits, tasks, project opens, prompt counts). */
  keepActivityHistory: boolean
  /** Persist redacted prompt text. Off by default — prompt counts still work without it. */
  savePromptHistory: boolean
  /** Allow sending redacted prompts to an external analysis provider. Requires explicit opt-in. */
  analyzePromptsWithAi: boolean
  /** Scan project folders (locally) to inform language/framework metrics. */
  useProjectFileContext: boolean
  /** Use Git activity (commits, changed files) for metrics. */
  useGitActivity: boolean
  /** Allow enabled memories to be offered to future agent prompts. */
  includeMemoryInPrompts: boolean
  /** Days to keep history. 0 means keep forever. */
  retentionDays: number
}

export const RETENTION_OPTIONS = [30, 90, 180, 365, 0] as const

export function createDefaultDeveloperIntelligenceSettings(): DeveloperIntelligenceSettings {
  return {
    keepActivityHistory: true,
    savePromptHistory: false,
    analyzePromptsWithAi: false,
    useProjectFileContext: true,
    useGitActivity: true,
    includeMemoryInPrompts: false,
    retentionDays: 90
  }
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type MetricsRangeKey = 'today' | '7d' | '30d' | 'month' | 'all'

export interface MetricsRequest {
  range: MetricsRangeKey
  /** Project folders to include in the local language census (only used when enabled). */
  projects?: Array<{ id: string; name: string; folderPath: string | null }>
}

export type MetricAvailability = 'measured' | 'estimated' | 'unavailable'

export interface MeasuredNumber {
  value: number | null
  availability: MetricAvailability
}

export interface DistributionEntry {
  label: string
  /** 0–100, rounded to one decimal. */
  percent: number
  /** Raw weight/evidence count behind the percent. */
  weight: number
}

export interface LanguageDistribution {
  entries: DistributionEntry[]
  /** Human-readable description of what the percentages measure. */
  basis: string[]
  unknownPercent: number
}

export interface FrameworkSignal {
  name: string
  evidenceCount: number
  confidence: 'low' | 'medium' | 'high'
  sources: string[]
}

export interface DailyCount {
  /** YYYY-MM-DD in local time. */
  day: string
  count: number
}

export interface DeveloperMetrics {
  range: { key: MetricsRangeKey; from: number; to: number }
  computedAt: number
  overview: {
    promptsSent: number
    sessions: number
    activeProjects: number
    providersUsed: number
    commits: number
    tasksCompleted: number
    averagePromptChars: MeasuredNumber
    averageSessionDurationMs: MeasuredNumber
    mostActivePeriod: string | null
    totalTokens: MeasuredNumber
    inputTokens: MeasuredNumber
    outputTokens: MeasuredNumber
    cachedTokens: MeasuredNumber
    apiSpendUsd: MeasuredNumber
    /** Average primary usage limit from recorded usage snapshots in this range. */
    averagePrimaryLimitUsed: MeasuredNumber
    /** Change versus the previous period of equal length, in percent. */
    promptsDeltaPercent: number | null
    sessionsDeltaPercent: number | null
  }
  languages: LanguageDistribution
  frameworks: FrameworkSignal[]
  workCategories: { entries: DistributionEntry[]; basis: string }
  workflow: {
    mostUsedAgent: string | null
    mostUsedProject: { id: string; name: string } | null
    promptsPerSession: MeasuredNumber
    sessionsEndingInCommit: MeasuredNumber
    tasksCompletedDuringSessions: number
    /** Completed tasks in this range, grouped by the priority set on each task. */
    taskPriorityDistribution: DistributionEntry[]
    /** Most common ordered pair of agents used back to back, e.g. ['claude', 'codex']. */
    commonAgentSequence: string[] | null
    providerDistribution: DistributionEntry[]
    projectDistribution: DistributionEntry[]
  }
  /** Local interpretations of the numbers above — never presented as facts. */
  interpretations: MetricInterpretation[]
  activity: {
    dailyPrompts: DailyCount[]
    dailySessions: DailyCount[]
    lastActivityAt: number | null
  }
}

// ---------------------------------------------------------------------------
// Export / maintenance
// ---------------------------------------------------------------------------

export interface DeveloperIntelligenceExport {
  exportedAt: number
  appVersion: string
  settings: DeveloperIntelligenceSettings
  events: DeveloperEvent[]
  prompts: PromptRecord[]
  memories: DeveloperMemory[]
}

export type DeveloperIntelligenceExportResult =
  | { ok: true; filePath: string; counts: { events: number; prompts: number; memories: number } }
  | { ok: false; canceled: true }

export interface DeveloperIntelligenceStats {
  eventCount: number
  promptCount: number
  memoryCount: number
  oldestEventAt: number | null
  lastAnalysisAt: number | null
}

export type ClearTarget = 'prompts' | 'events' | 'memories' | 'ai-memories' | 'all'

export const DEVELOPER_INTELLIGENCE_IPC = {
  RECORD_EVENT: 'developer-intelligence:record-event',
  RECORD_PROMPT: 'developer-intelligence:record-prompt',
  LIST_PROMPTS: 'developer-intelligence:list-prompts',
  DELETE_PROMPTS: 'developer-intelligence:delete-prompts',
  GET_METRICS: 'developer-intelligence:get-metrics',
  LIST_MEMORIES: 'developer-intelligence:list-memories',
  CREATE_MEMORY: 'developer-intelligence:create-memory',
  UPDATE_MEMORY: 'developer-intelligence:update-memory',
  DELETE_MEMORY: 'developer-intelligence:delete-memory',
  GET_SETTINGS: 'developer-intelligence:get-settings',
  UPDATE_SETTINGS: 'developer-intelligence:update-settings',
  GET_STATS: 'developer-intelligence:get-stats',
  EXPORT: 'developer-intelligence:export',
  CLEAR: 'developer-intelligence:clear',
  ANALYZE: 'developer-intelligence:analyze',
  GET_CONTEXT: 'developer-intelligence:get-context'
} as const

export const DEVELOPER_EVENT_TYPES: DeveloperEventType[] = [
  'prompt.sent',
  'agent.session.started',
  'agent.session.ended',
  'git.commit',
  'git.file.changed',
  'project.opened',
  'usage.snapshot',
  'task.started',
  'task.completed'
]

export const PROMPT_SOURCES: PromptSource[] = ['terminal', 'web-chat', 'handoff', 'other']

export const MAX_PROMPT_CHARS = 20_000
