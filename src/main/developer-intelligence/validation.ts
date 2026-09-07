import {
  DEVELOPER_EVENT_TYPES,
  MAX_PROMPT_CHARS,
  MEMORY_CATEGORIES,
  PROMPT_SOURCES,
  WORK_CATEGORIES,
  type ClearTarget,
  type DeveloperEventInput,
  type DeveloperEventType,
  type DeveloperIntelligenceSettings,
  type MemoryContextRequest,
  type MemoryDraft,
  type MemoryUpdate,
  type MetricsRequest,
  type PromptHistoryFilter,
  type PromptSource,
  type RecordPromptRequest,
  type WorkCategory
} from '@shared/contracts/developer-intelligence'

/** Validation for everything that crosses the IPC boundary into Developer Intelligence. */

const MAX_ID = 200
const MAX_SHORT_TEXT = 500
const MAX_FILES = 200
const KINDS = new Set(['terminal', 'claude', 'cursor', 'gemini', 'antigravity', 'codex'])
const PRIORITIES = new Set(['low', 'medium', 'high'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID ? value : undefined
}

function requiredText(value: unknown, max = MAX_SHORT_TEXT): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function optionalTimestamp(value: unknown): number | undefined {
  const parsed = finiteNumber(value)
  return parsed !== null && parsed > 0 ? parsed : undefined
}

function stringList(value: unknown, max: number, itemMax = MAX_SHORT_TEXT): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= itemMax)
    .slice(0, max)
}

function commonFields(raw: Record<string, unknown>): {
  projectId?: string
  sessionId?: string
  provider?: string
  accountId?: string
  occurredAt?: number
} {
  return {
    ...(optionalId(raw['projectId']) ? { projectId: optionalId(raw['projectId']) } : {}),
    ...(optionalId(raw['sessionId']) ? { sessionId: optionalId(raw['sessionId']) } : {}),
    ...(optionalId(raw['provider']) ? { provider: optionalId(raw['provider']) } : {}),
    ...(optionalId(raw['accountId']) ? { accountId: optionalId(raw['accountId']) } : {}),
    ...(optionalTimestamp(raw['occurredAt']) ? { occurredAt: optionalTimestamp(raw['occurredAt']) } : {})
  }
}

export function parseEventInput(payload: unknown): DeveloperEventInput | null {
  if (!isRecord(payload)) return null
  const type = payload['type']
  if (typeof type !== 'string' || !DEVELOPER_EVENT_TYPES.includes(type as DeveloperEventType)) return null
  const body = isRecord(payload['payload']) ? payload['payload'] : null
  if (!body) return null
  const common = commonFields(payload)

  switch (type as DeveloperEventType) {
    case 'prompt.sent': {
      // Prompts are recorded through the dedicated prompt endpoint so text can be redacted.
      return null
    }
    case 'agent.session.started': {
      const kind = body['kind']
      if (typeof kind !== 'string' || !KINDS.has(kind)) return null
      return {
        type: 'agent.session.started',
        ...common,
        payload: {
          kind: kind as 'terminal',
          ...(body['launchMode'] === 'login' ? { launchMode: 'login' as const } : { launchMode: 'normal' as const })
        }
      }
    }
    case 'agent.session.ended': {
      const kind = body['kind']
      const durationMs = finiteNumber(body['durationMs'])
      const promptCount = finiteNumber(body['promptCount'])
      if (typeof kind !== 'string' || !KINDS.has(kind) || durationMs === null || durationMs < 0) return null
      const exitCode = finiteNumber(body['exitCode'])
      return {
        type: 'agent.session.ended',
        ...common,
        payload: {
          kind: kind as 'terminal',
          durationMs: Math.floor(durationMs),
          promptCount: Math.max(0, Math.floor(promptCount ?? 0)),
          exitCode: exitCode === null ? null : Math.floor(exitCode)
        }
      }
    }
    case 'git.commit': {
      const message = typeof body['message'] === 'string' ? body['message'].slice(0, 2000) : ''
      const files = stringList(body['files'], MAX_FILES, 1000)
      const fileCount = Math.max(files.length, Math.floor(finiteNumber(body['fileCount']) ?? 0))
      return {
        type: 'git.commit',
        ...common,
        payload: { message, fileCount, files, languages: {} }
      }
    }
    case 'git.file.changed': {
      const files = stringList(body['files'], MAX_FILES, 1000)
      const fileCount = Math.max(files.length, Math.floor(finiteNumber(body['fileCount']) ?? 0))
      const stagedCount = Math.max(0, Math.floor(finiteNumber(body['stagedCount']) ?? 0))
      const unstagedCount = Math.max(0, Math.floor(finiteNumber(body['unstagedCount']) ?? 0))
      return {
        type: 'git.file.changed',
        ...common,
        payload: { fileCount, files, languages: {}, stagedCount, unstagedCount }
      }
    }
    case 'usage.snapshot': {
      const kind = body['kind']
      if (typeof kind !== 'string' || !KINDS.has(kind)) return null
      const primary = finiteNumber(body['primaryUsedPercent'])
      const secondary = finiteNumber(body['secondaryUsedPercent'])
      const planType =
        typeof body['planType'] === 'string' && body['planType'].length <= 100 ? body['planType'] : undefined
      return {
        type: 'usage.snapshot',
        ...common,
        payload: {
          kind: kind as 'claude',
          primaryUsedPercent: primary === null ? null : Math.max(0, Math.min(100, primary)),
          ...(secondary !== null ? { secondaryUsedPercent: Math.max(0, Math.min(100, secondary)) } : {}),
          ...(planType ? { planType } : {})
        }
      }
    }
    case 'project.opened': {
      const name = requiredText(body['name']) ?? 'Untitled'
      const folderPath = typeof body['folderPath'] === 'string' && body['folderPath'].length <= 4096
        ? body['folderPath']
        : null
      return { type: 'project.opened', ...common, payload: { name, folderPath } }
    }
    case 'task.started':
    case 'task.completed': {
      const taskId = optionalId(body['taskId'])
      const title = requiredText(body['title'])
      const priority = body['priority']
      if (!taskId || !title || typeof priority !== 'string' || !PRIORITIES.has(priority)) return null
      return {
        type: type as 'task.started',
        ...common,
        payload: { taskId, title, priority: priority as 'low' }
      }
    }
    default:
      return null
  }
}

export function parsePromptRequest(payload: unknown): RecordPromptRequest | null {
  if (!isRecord(payload)) return null
  const prompt = payload['prompt']
  if (typeof prompt !== 'string' || prompt.trim().length === 0) return null
  const source = payload['source']
  if (typeof source !== 'string' || !PROMPT_SOURCES.includes(source as PromptSource)) return null
  const common = commonFields(payload)
  return {
    prompt: prompt.slice(0, MAX_PROMPT_CHARS),
    source: source as PromptSource,
    ...(common.projectId ? { projectId: common.projectId } : {}),
    ...(common.sessionId ? { sessionId: common.sessionId } : {}),
    ...(common.provider ? { provider: common.provider } : {}),
    ...(common.accountId ? { accountId: common.accountId } : {})
  }
}

export function parsePromptFilter(payload: unknown): PromptHistoryFilter {
  if (!isRecord(payload)) return {}
  const category = payload['category']
  const source = payload['source']
  const limit = finiteNumber(payload['limit'])
  const offset = finiteNumber(payload['offset'])
  return {
    ...(optionalId(payload['provider']) ? { provider: optionalId(payload['provider']) } : {}),
    ...(optionalId(payload['projectId']) ? { projectId: optionalId(payload['projectId']) } : {}),
    ...(typeof category === 'string' && WORK_CATEGORIES.includes(category as WorkCategory)
      ? { category: category as WorkCategory }
      : {}),
    ...(typeof source === 'string' && PROMPT_SOURCES.includes(source as PromptSource)
      ? { source: source as PromptSource }
      : {}),
    ...(optionalTimestamp(payload['from']) ? { from: optionalTimestamp(payload['from']) } : {}),
    ...(optionalTimestamp(payload['to']) ? { to: optionalTimestamp(payload['to']) } : {}),
    ...(typeof payload['search'] === 'string' && payload['search'].trim()
      ? { search: payload['search'].trim().slice(0, 200) }
      : {}),
    ...(limit !== null ? { limit } : {}),
    ...(offset !== null ? { offset } : {})
  }
}

export function parseIdList(payload: unknown): string[] | 'all' | null {
  if (payload === 'all') return 'all'
  if (!Array.isArray(payload) || payload.length > 5000) return null
  const ids = payload.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID)
  return ids.length === payload.length ? ids : null
}

export function parseMetricsRequest(payload: unknown): MetricsRequest | null {
  if (!isRecord(payload)) return null
  const range = payload['range']
  if (range !== 'today' && range !== '7d' && range !== '30d' && range !== 'month' && range !== 'all') return null
  const projects = Array.isArray(payload['projects'])
    ? payload['projects']
        .filter(isRecord)
        .flatMap((project) => {
          const id = optionalId(project['id'])
          const name = requiredText(project['name'])
          if (!id || !name) return []
          const folderPath =
            typeof project['folderPath'] === 'string' && project['folderPath'].length <= 4096
              ? project['folderPath']
              : null
          return [{ id, name, folderPath }]
        })
        .slice(0, 50)
    : []
  return { range, projects }
}

export function parseMemoryDraft(payload: unknown): MemoryDraft | null {
  if (!isRecord(payload)) return null
  const scope = payload['scope']
  if (scope !== 'global' && scope !== 'project') return null
  const content = requiredText(payload['content'], 2000)
  if (!content) return null
  const category = requiredText(payload['category'], 100) ?? MEMORY_CATEGORIES[MEMORY_CATEGORIES.length - 1]
  const projectId = optionalId(payload['projectId'])
  if (scope === 'project' && !projectId) return null
  return {
    scope,
    ...(scope === 'project' && projectId ? { projectId } : {}),
    category,
    content
  }
}

export function parseMemoryUpdate(payload: unknown): { id: string; updates: MemoryUpdate } | null {
  if (!isRecord(payload)) return null
  const id = optionalId(payload['id'])
  const raw = isRecord(payload['updates']) ? payload['updates'] : null
  if (!id || !raw) return null
  const updates: MemoryUpdate = {}
  if (raw['scope'] === 'global' || raw['scope'] === 'project') updates.scope = raw['scope']
  if (typeof raw['projectId'] === 'string') updates.projectId = optionalId(raw['projectId'])
  if (typeof raw['category'] === 'string') {
    const category = requiredText(raw['category'], 100)
    if (category) updates.category = category
  }
  if (typeof raw['content'] === 'string') {
    const content = requiredText(raw['content'], 2000)
    if (!content) return null
    updates.content = content
  }
  if (typeof raw['enabled'] === 'boolean') updates.enabled = raw['enabled']
  return { id, updates }
}

export function parseSettingsUpdate(payload: unknown): Partial<DeveloperIntelligenceSettings> | null {
  if (!isRecord(payload)) return null
  const updates: Partial<DeveloperIntelligenceSettings> = {}
  const booleanKeys: Array<keyof DeveloperIntelligenceSettings> = [
    'keepActivityHistory',
    'savePromptHistory',
    'analyzePromptsWithAi',
    'useProjectFileContext',
    'useGitActivity',
    'includeMemoryInPrompts'
  ]
  for (const key of booleanKeys) {
    const value = payload[key]
    if (typeof value === 'boolean') Object.assign(updates, { [key]: value })
  }
  const retention = finiteNumber(payload['retentionDays'])
  if (retention !== null) updates.retentionDays = retention
  return updates
}

export function parseClearTarget(payload: unknown): ClearTarget | null {
  return payload === 'prompts' ||
    payload === 'events' ||
    payload === 'memories' ||
    payload === 'ai-memories' ||
    payload === 'all'
    ? payload
    : null
}

export function parseContextRequest(payload: unknown): MemoryContextRequest | null {
  if (payload === undefined || payload === null) return {}
  if (!isRecord(payload)) return null
  const limit = finiteNumber(payload['limit'])
  const query = typeof payload['query'] === 'string' ? payload['query'].trim().slice(0, 500) : ''
  return {
    ...(optionalId(payload['projectId']) ? { projectId: optionalId(payload['projectId']) } : {}),
    ...(query ? { query } : {}),
    ...(limit !== null ? { limit: Math.min(20, Math.max(1, Math.floor(limit))) } : {})
  }
}
