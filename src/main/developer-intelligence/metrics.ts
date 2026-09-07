import type {
  DailyCount,
  DeveloperEvent,
  DeveloperMetrics,
  DistributionEntry,
  FrameworkSignal,
  LanguageDistribution,
  MeasuredNumber,
  MetricInterpretation,
  MetricsRangeKey,
  WorkCategory
} from '@shared/contracts/developer-intelligence'

export interface ProjectCensus {
  projectId: string
  fileCount: number
  byLanguage: Record<string, number>
  frameworks: string[]
}

export interface MetricsInput {
  /** All events that may be relevant: current range plus the previous period of equal length. */
  events: DeveloperEvent[]
  range: { key: MetricsRangeKey; from: number; to: number }
  now: number
  projectNames: Record<string, string>
  projectCensus: ProjectCensus[]
  promptFrameworkHints: Record<string, number>
  settings: { useGitActivity: boolean; useProjectFileContext: boolean }
}

const DAY_MS = 24 * 60 * 60 * 1000
const COMMIT_GRACE_MS = 10 * 60 * 1000

export function resolveMetricsRange(
  key: MetricsRangeKey,
  now: number
): { key: MetricsRangeKey; from: number; to: number } {
  const current = new Date(now)
  if (key === 'today') {
    const start = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime()
    return { key, from: start, to: now }
  }
  if (key === '7d') return { key, from: now - 7 * DAY_MS, to: now }
  if (key === '30d') return { key, from: now - 30 * DAY_MS, to: now }
  if (key === 'month') {
    const start = new Date(current.getFullYear(), current.getMonth(), 1).getTime()
    return { key, from: start, to: now }
  }
  return { key, from: 0, to: now }
}

function unavailable(): MeasuredNumber {
  return { value: null, availability: 'unavailable' }
}

function measured(value: number | null): MeasuredNumber {
  return value === null || !Number.isFinite(value)
    ? unavailable()
    : { value, availability: 'measured' }
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((total, value) => total + value, 0) / values.length
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function deltaPercent(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return round1(((current - previous) / previous) * 100)
}

function toDistribution(counts: Map<string, number>, limit = 8): DistributionEntry[] {
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0)
  if (total <= 0) return []
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted.slice(0, limit)
  const rest = sorted.slice(limit)
  const entries = top.map(([label, weight]) => ({
    label,
    weight,
    percent: round1((weight / total) * 100)
  }))
  if (rest.length > 0) {
    const restWeight = rest.reduce((sum, [, weight]) => sum + weight, 0)
    entries.push({ label: 'Other', weight: restWeight, percent: round1((restWeight / total) * 100) })
  }
  return entries
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function dailyCounts(
  timestamps: number[],
  range: { key: MetricsRangeKey; from: number; to: number }
): DailyCount[] {
  const counts = new Map<string, number>()
  for (const timestamp of timestamps) {
    const key = localDayKey(timestamp)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const spanDays = Math.ceil((range.to - range.from) / DAY_MS)
  if (range.key !== 'all' && spanDays <= 62) {
    const filled: DailyCount[] = []
    const cursor = new Date(range.from)
    cursor.setHours(0, 0, 0, 0)
    while (cursor.getTime() <= range.to) {
      const key = localDayKey(cursor.getTime())
      filled.push({ day: key, count: counts.get(key) ?? 0 })
      cursor.setDate(cursor.getDate() + 1)
    }
    return filled
  }

  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, count]) => ({ day, count }))
}

function periodLabel(hour: number): string {
  if (hour < 6) return 'Night (00:00–06:00)'
  if (hour < 12) return 'Morning (06:00–12:00)'
  if (hour < 18) return 'Afternoon (12:00–18:00)'
  return 'Evening (18:00–24:00)'
}

function mostActivePeriod(timestamps: number[]): string | null {
  if (timestamps.length === 0) return null
  const buckets = new Map<string, number>()
  for (const timestamp of timestamps) {
    const label = periodLabel(new Date(timestamp).getHours())
    buckets.set(label, (buckets.get(label) ?? 0) + 1)
  }
  return [...buckets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

interface LanguageSource {
  label: string
  weight: number
  counts: Record<string, number>
  sampleCount: number
}

function combineLanguageSources(sources: LanguageSource[]): LanguageDistribution {
  const active = sources.filter(
    (source) => Object.values(source.counts).reduce((sum, value) => sum + value, 0) > 0
  )
  if (active.length === 0) return { entries: [], basis: [], unknownPercent: 0 }

  const weightTotal = active.reduce((sum, source) => sum + source.weight, 0)
  const combined = new Map<string, number>()
  let unknownShare = 0

  for (const source of active) {
    const total = Object.values(source.counts).reduce((sum, value) => sum + value, 0)
    const normalizedWeight = source.weight / weightTotal
    for (const [language, count] of Object.entries(source.counts)) {
      const share = (count / total) * normalizedWeight
      if (language === 'unknown') {
        unknownShare += share
        continue
      }
      combined.set(language, (combined.get(language) ?? 0) + share)
    }
  }

  const knownTotal = [...combined.values()].reduce((sum, value) => sum + value, 0)
  const entries =
    knownTotal > 0
      ? toDistribution(
          new Map([...combined.entries()].map(([label, share]) => [label, share / knownTotal]))
        ).map((entry) => ({ ...entry, weight: round1(entry.weight * 100) }))
      : []

  return {
    entries,
    basis: active.map((source) => `${source.label} (${source.sampleCount})`),
    unknownPercent: round1(unknownShare * 100)
  }
}

export function computeMetrics(input: MetricsInput): DeveloperMetrics {
  const { events, range, now, projectNames, projectCensus, settings } = input
  const span = range.key === 'all' ? 0 : range.to - range.from
  const previousFrom = range.from - span

  const inRange = events.filter((event) => event.occurredAt >= range.from && event.occurredAt <= range.to)
  const previous =
    span > 0
      ? events.filter((event) => event.occurredAt >= previousFrom && event.occurredAt < range.from)
      : []

  const prompts = inRange.filter((event) => event.type === 'prompt.sent')
  const sessionStarts = inRange.filter((event) => event.type === 'agent.session.started')
  const sessionEnds = inRange.filter((event) => event.type === 'agent.session.ended')
  const commits = settings.useGitActivity ? inRange.filter((event) => event.type === 'git.commit') : []
  const tasksCompleted = inRange.filter((event) => event.type === 'task.completed')

  const previousPrompts = previous.filter((event) => event.type === 'prompt.sent').length
  const previousSessions = previous.filter((event) => event.type === 'agent.session.started').length

  const projectIds = new Set<string>()
  const providers = new Set<string>()
  for (const event of inRange) {
    if (event.projectId) projectIds.add(event.projectId)
    if (event.provider && (event.type === 'prompt.sent' || event.type === 'agent.session.started')) {
      providers.add(event.provider)
    }
  }

  const promptChars = prompts.map((event) =>
    event.type === 'prompt.sent' ? event.payload.charCount : 0
  )
  const sessionDurations = sessionEnds.map((event) =>
    event.type === 'agent.session.ended' ? event.payload.durationMs : 0
  )

  // --- Languages -----------------------------------------------------------
  const gitLanguages: Record<string, number> = {}
  let gitFileCount = 0
  for (const event of commits) {
    if (event.type !== 'git.commit') continue
    gitFileCount += event.payload.fileCount
    for (const [language, count] of Object.entries(event.payload.languages)) {
      gitLanguages[language] = (gitLanguages[language] ?? 0) + count
    }
  }

  const projectLanguages: Record<string, number> = {}
  let projectFileCount = 0
  if (settings.useProjectFileContext) {
    for (const census of projectCensus) {
      projectFileCount += census.fileCount
      for (const [language, count] of Object.entries(census.byLanguage)) {
        projectLanguages[language] = (projectLanguages[language] ?? 0) + count
      }
    }
  }

  const promptLanguages: Record<string, number> = {}
  let promptsWithHints = 0
  for (const event of prompts) {
    if (event.type !== 'prompt.sent') continue
    const hints = event.payload.languageHints ?? []
    if (hints.length === 0) continue
    promptsWithHints += 1
    for (const hint of hints) {
      promptLanguages[hint] = (promptLanguages[hint] ?? 0) + 1
    }
  }

  const languages = combineLanguageSources([
    { label: 'Git changed files', weight: 0.5, counts: gitLanguages, sampleCount: gitFileCount },
    { label: 'Project files', weight: 0.3, counts: projectLanguages, sampleCount: projectFileCount },
    {
      label: 'Code blocks and file names in prompts',
      weight: 0.2,
      counts: promptLanguages,
      sampleCount: promptsWithHints
    }
  ])

  // --- Frameworks ----------------------------------------------------------
  const frameworkEvidence = new Map<string, { count: number; sources: Set<string> }>()
  const addEvidence = (name: string, amount: number, source: string): void => {
    const current = frameworkEvidence.get(name) ?? { count: 0, sources: new Set<string>() }
    current.count += amount
    current.sources.add(source)
    frameworkEvidence.set(name, current)
  }
  if (settings.useProjectFileContext) {
    for (const census of projectCensus) {
      for (const framework of census.frameworks) addEvidence(framework, 2, 'project files')
    }
  }
  for (const [framework, mentions] of Object.entries(input.promptFrameworkHints)) {
    if (mentions > 0) addEvidence(framework, Math.min(mentions, 5), 'prompts')
  }
  const frameworks: FrameworkSignal[] = [...frameworkEvidence.entries()]
    .map(([name, evidence]) => ({
      name,
      evidenceCount: evidence.count,
      confidence: evidence.count >= 5 ? 'high' : evidence.count >= 3 ? 'medium' : 'low',
      sources: [...evidence.sources]
    }) satisfies FrameworkSignal)
    .sort((a, b) => b.evidenceCount - a.evidenceCount)
    .slice(0, 10)

  // --- Work categories -----------------------------------------------------
  const categoryCounts = new Map<string, number>()
  let categorizedPrompts = 0
  let categorizedCommits = 0
  const bump = (category: WorkCategory | undefined): boolean => {
    if (!category) return false
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
    return true
  }
  for (const event of prompts) {
    if (event.type === 'prompt.sent' && bump(event.payload.category)) categorizedPrompts += 1
  }
  for (const event of commits) {
    if (event.type === 'git.commit' && bump(event.payload.category)) categorizedCommits += 1
  }

  // --- Workflow ------------------------------------------------------------
  const providerPromptCounts = new Map<string, number>()
  for (const event of prompts) {
    if (event.provider) providerPromptCounts.set(event.provider, (providerPromptCounts.get(event.provider) ?? 0) + 1)
  }
  const providerSessionCounts = new Map<string, number>()
  for (const event of sessionStarts) {
    if (event.provider) providerSessionCounts.set(event.provider, (providerSessionCounts.get(event.provider) ?? 0) + 1)
  }
  const providerSource = providerPromptCounts.size > 0 ? providerPromptCounts : providerSessionCounts
  const mostUsedAgent = [...providerSource.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const projectActivity = new Map<string, number>()
  for (const event of inRange) {
    if (!event.projectId) continue
    if (event.type === 'prompt.sent' || event.type === 'agent.session.started' || event.type === 'git.commit') {
      projectActivity.set(event.projectId, (projectActivity.get(event.projectId) ?? 0) + 1)
    }
  }
  const topProjectId = [...projectActivity.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const mostUsedProject = topProjectId
    ? { id: topProjectId, name: projectNames[topProjectId] ?? 'Unknown project' }
    : null

  const sessionStartById = new Map<string, number>()
  for (const event of sessionStarts) {
    if (event.sessionId) sessionStartById.set(event.sessionId, event.occurredAt)
  }
  const commitTimesByProject = new Map<string, number[]>()
  for (const event of commits) {
    if (!event.projectId) continue
    const list = commitTimesByProject.get(event.projectId) ?? []
    list.push(event.occurredAt)
    commitTimesByProject.set(event.projectId, list)
  }
  let sessionsWithCommit = 0
  for (const event of sessionEnds) {
    if (event.type !== 'agent.session.ended' || !event.projectId) continue
    const start =
      (event.sessionId ? sessionStartById.get(event.sessionId) : undefined) ??
      event.occurredAt - event.payload.durationMs
    const commitTimes = commitTimesByProject.get(event.projectId) ?? []
    if (commitTimes.some((time) => time >= start && time <= event.occurredAt + COMMIT_GRACE_MS)) {
      sessionsWithCommit += 1
    }
  }

  const sessionWindowsByProject = new Map<string, Array<{ start: number; end: number }>>()
  for (const event of sessionEnds) {
    if (event.type !== 'agent.session.ended' || !event.projectId) continue
    const start =
      (event.sessionId ? sessionStartById.get(event.sessionId) : undefined) ??
      event.occurredAt - event.payload.durationMs
    const windows = sessionWindowsByProject.get(event.projectId) ?? []
    windows.push({ start, end: event.occurredAt })
    sessionWindowsByProject.set(event.projectId, windows)
  }
  // Sessions still running count as open windows up to `now`.
  const endedSessionIds = new Set(sessionEnds.map((event) => event.sessionId).filter(Boolean))
  for (const event of sessionStarts) {
    if (!event.projectId || (event.sessionId && endedSessionIds.has(event.sessionId))) continue
    const windows = sessionWindowsByProject.get(event.projectId) ?? []
    windows.push({ start: event.occurredAt, end: now })
    sessionWindowsByProject.set(event.projectId, windows)
  }
  let tasksCompletedDuringSessions = 0
  for (const event of tasksCompleted) {
    if (!event.projectId) continue
    const windows = sessionWindowsByProject.get(event.projectId) ?? []
    if (windows.some((window) => event.occurredAt >= window.start && event.occurredAt <= window.end)) {
      tasksCompletedDuringSessions += 1
    }
  }

  const orderedProviders = [...sessionStarts]
    .sort((a, b) => a.occurredAt - b.occurredAt)
    .map((event) => event.provider)
    .filter((provider): provider is string => Boolean(provider))
  const bigrams = new Map<string, number>()
  for (let index = 1; index < orderedProviders.length; index += 1) {
    const previousProvider = orderedProviders[index - 1]
    const currentProvider = orderedProviders[index]
    if (previousProvider === currentProvider) continue
    const key = `${previousProvider}\u0000${currentProvider}`
    bigrams.set(key, (bigrams.get(key) ?? 0) + 1)
  }
  const topBigram = [...bigrams.entries()].sort((a, b) => b[1] - a[1])[0]
  const commonAgentSequence = topBigram && topBigram[1] >= 2 ? topBigram[0].split('\u0000') : null

  const lastActivityAt = events.reduce<number | null>(
    (latest, event) => (latest === null || event.occurredAt > latest ? event.occurredAt : latest),
    null
  )

  const overview: DeveloperMetrics['overview'] = {
    promptsSent: prompts.length,
    sessions: sessionStarts.length,
    activeProjects: projectIds.size,
    providersUsed: providers.size,
    commits: commits.length,
    tasksCompleted: tasksCompleted.length,
    averagePromptChars: measured(mean(promptChars)),
    averageSessionDurationMs: measured(mean(sessionDurations)),
    mostActivePeriod: mostActivePeriod([
      ...prompts.map((event) => event.occurredAt),
      ...sessionStarts.map((event) => event.occurredAt)
    ]),
    totalTokens: unavailable(),
    inputTokens: unavailable(),
    outputTokens: unavailable(),
    cachedTokens: unavailable(),
    apiSpendUsd: unavailable(),
    promptsDeltaPercent: deltaPercent(prompts.length, previousPrompts),
    sessionsDeltaPercent: deltaPercent(sessionStarts.length, previousSessions)
  }

  const workflow: DeveloperMetrics['workflow'] = {
    mostUsedAgent,
    mostUsedProject,
    promptsPerSession:
      sessionStarts.length > 0 ? measured(round1(prompts.length / sessionStarts.length)) : unavailable(),
    sessionsEndingInCommit:
      sessionEnds.length > 0 && settings.useGitActivity
        ? measured(round1((sessionsWithCommit / sessionEnds.length) * 100))
        : unavailable(),
    tasksCompletedDuringSessions,
    commonAgentSequence,
    providerDistribution: toDistribution(providerSource),
    projectDistribution: toDistribution(
      new Map(
        [...projectActivity.entries()].map(([projectId, count]) => [
          projectNames[projectId] ?? 'Unknown project',
          count
        ])
      )
    )
  }

  const workCategories = {
    entries: toDistribution(categoryCounts, 9),
    basis:
      categorizedPrompts + categorizedCommits > 0
        ? `Heuristic keyword classification of ${categorizedPrompts} prompts and ${categorizedCommits} commit messages`
        : 'No classified prompts or commits in this range'
  }

  return {
    range,
    computedAt: now,
    overview,
    languages,
    frameworks,
    workCategories,
    workflow,
    interpretations: deriveInterpretations({ languages, frameworks, workCategories, workflow, overview }),
    activity: {
      dailyPrompts: dailyCounts(prompts.map((event) => event.occurredAt), range),
      dailySessions: dailyCounts(sessionStarts.map((event) => event.occurredAt), range),
      lastActivityAt
    }
  }
}

const LANGUAGE_TITLES: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  java: 'Java'
}

function languageTitle(id: string): string {
  return LANGUAGE_TITLES[id] ?? id
}

function agentTitle(id: string): string {
  const labels: Record<string, string> = {
    claude: 'Claude Code',
    cursor: 'Cursor CLI',
    gemini: 'Gemini CLI',
    antigravity: 'Antigravity CLI',
    codex: 'Codex CLI'
  }
  return labels[id] ?? id
}

export function deriveInterpretations(input: {
  languages: LanguageDistribution
  frameworks: FrameworkSignal[]
  workCategories: { entries: DistributionEntry[]; basis: string }
  workflow: DeveloperMetrics['workflow']
  overview: DeveloperMetrics['overview']
}): MetricInterpretation[] {
  const out: MetricInterpretation[] = []
  const topLanguage = input.languages.entries[0]
  if (topLanguage && topLanguage.percent >= 25) {
    out.push({
      text: `${languageTitle(topLanguage.label)} accounts for ${Math.round(topLanguage.percent)}% of language activity in this range.`,
      basis: input.languages.basis.join(' · ') || 'language activity'
    })
  }

  const promptDelta = input.overview.promptsDeltaPercent
  if (promptDelta !== null && Math.abs(promptDelta) >= 20) {
    out.push({
      text:
        promptDelta > 0
          ? `Prompt volume increased ${Math.round(promptDelta)}% versus the previous period.`
          : `Prompt volume decreased ${Math.round(Math.abs(promptDelta))}% versus the previous period.`,
      basis: 'prompt counts compared with the previous period of equal length'
    })
  }

  const topCategory = input.workCategories.entries[0]
  if (topCategory && topCategory.percent >= 30) {
    out.push({
      text: `Main recorded activity is ${topCategory.label.toLowerCase()} (${Math.round(topCategory.percent)}%).`,
      basis: input.workCategories.basis
    })
  }

  if (input.workflow.mostUsedAgent) {
    out.push({
      text: `Most-used agent in this range is ${agentTitle(input.workflow.mostUsedAgent)}.`,
      basis: 'session and prompt counts by provider'
    })
  }

  if (input.workflow.commonAgentSequence && input.workflow.commonAgentSequence.length === 2) {
    const [first, second] = input.workflow.commonAgentSequence
    out.push({
      text: `Sessions often move from ${agentTitle(first)} to ${agentTitle(second)}.`,
      basis: 'most frequent back-to-back pair of agent sessions'
    })
  }

  const commitRate = input.workflow.sessionsEndingInCommit
  if (commitRate.availability === 'measured' && commitRate.value !== null && commitRate.value >= 20) {
    out.push({
      text: `About ${Math.round(commitRate.value)}% of sessions end in a Git commit.`,
      basis: 'commit within 10 minutes of a session in the same project'
    })
  }

  const strongFrameworks = input.frameworks.filter((framework) => framework.confidence !== 'low').slice(0, 3)
  if (strongFrameworks.length > 0) {
    const names = strongFrameworks.map((framework) => framework.name)
    out.push({
      text: `Project and prompt evidence points to ${names.join(', ')}.`,
      basis: 'package manifests and prompt mentions'
    })
  }

  return out.slice(0, 6)
}
