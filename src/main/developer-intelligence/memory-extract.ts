import { AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import type {
  DeveloperMemory,
  DeveloperMetrics,
  MemoryCandidate,
  MemoryContextItem,
  MemoryContextPackage,
  MemoryContextRequest,
  PromptRecord
} from '@shared/contracts/developer-intelligence'
import type { ProjectCensus } from './metrics'

/**
 * Local heuristic memory extraction and context ranking.
 * Nothing here calls a model or leaves the machine.
 */

const LANGUAGE_TITLES: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  dart: 'Dart',
  php: 'PHP',
  ruby: 'Ruby',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  sql: 'SQL',
  shell: 'Shell',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  dockerfile: 'Dockerfile'
}

function languageTitle(id: string): string {
  return LANGUAGE_TITLES[id] ?? id
}

function agentTitle(id: string): string {
  return (AI_ACCOUNT_LABELS as Record<string, string>)[id] ?? id
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
}

function candidate(
  partial: Omit<MemoryCandidate, 'confidence'> & { confidence: number }
): MemoryCandidate {
  const next: MemoryCandidate = {
    key: partial.key,
    scope: partial.scope,
    category: partial.category,
    content: partial.content,
    confidence: clampConfidence(partial.confidence),
    evidenceCount: Math.max(1, Math.floor(partial.evidenceCount))
  }
  if (partial.projectId) next.projectId = partial.projectId
  return next
}

interface StyleRule {
  key: string
  category: string
  content: string
  pattern: RegExp
}

const STYLE_RULES: StyleRule[] = [
  {
    key: 'style-strict-ts',
    category: 'Coding style',
    content: 'Prefers TypeScript strict mode.',
    pattern: /\bstrict mode\b|noimplicitany|strictnullchecks|typescript strict|\bstrict: true\b/i
  },
  {
    key: 'style-avoid-any',
    category: 'Coding style',
    content: 'Avoids `any` where practical.',
    pattern: /\bavoid(?:s|ing)?\s+`?any`?\b|\bno any\b|don'?t use any|without using any/i
  },
  {
    key: 'style-small-components',
    category: 'Coding style',
    content: 'Prefers small React components.',
    pattern: /small (?:react )?components|keep components small|split (?:the )?component|one component per/i
  },
  {
    key: 'style-plan-first',
    category: 'Workflow',
    content: 'Prefers plan → implement → review workflows.',
    pattern: /\bplan\b.{0,40}\bimplement\b|plan → implement|write a plan first|before implementing/i
  },
  {
    key: 'style-tests',
    category: 'Workflow',
    content: 'Prefers writing tests alongside or before implementation.',
    pattern: /write tests first|\btdd\b|test-driven|add tests before|tests alongside/i
  },
  {
    key: 'style-functional-react',
    category: 'Coding style',
    content: 'Prefers functional React components over class components.',
    pattern: /functional (?:react )?components|hooks instead of classes|no class components/i
  },
  {
    key: 'style-named-exports',
    category: 'Coding style',
    content: 'Prefers named exports over default exports.',
    pattern: /named exports|no default exports|avoid default export/i
  },
  {
    key: 'style-match-existing',
    category: 'Coding style',
    content: 'Match existing file conventions rather than introducing new patterns.',
    pattern: /match existing|follow (?:the )?existing (?:style|conventions|patterns)|don'?t (?:introduce|invent) new patterns/i
  },
  {
    key: 'style-focused-diffs',
    category: 'Workflow',
    content: 'Wants focused diffs without unrelated drive-by changes.',
    pattern: /no drive-by|don'?t refactor unrelated|focused (?:diff|pr|change)|only change what(?: is|'s)? (?:asked|needed)/i
  }
]

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export interface ExtractMemoriesInput {
  metrics: DeveloperMetrics
  projectCensus: ProjectCensus[]
  prompts: PromptRecord[]
  projectNames: Record<string, string>
}

export function extractMemoryCandidates(input: ExtractMemoriesInput): MemoryCandidate[] {
  const { metrics, projectCensus, prompts, projectNames } = input
  const out: MemoryCandidate[] = []
  const languageEvidence =
    metrics.languages.entries.reduce((sum, entry) => sum + entry.weight, 0) +
    projectCensus.reduce((sum, census) => sum + census.fileCount, 0)

  const topLanguage = metrics.languages.entries[0]
  if (topLanguage && topLanguage.percent >= 40 && languageEvidence >= 3) {
    out.push(
      candidate({
        key: 'language-primary',
        scope: 'global',
        category: 'Languages',
        content: `Primarily works in ${languageTitle(topLanguage.label)}.`,
        confidence: topLanguage.percent >= 55 ? 0.8 : 0.62,
        evidenceCount: Math.max(3, Math.round(topLanguage.weight))
      })
    )
  }

  const secondLanguage = metrics.languages.entries[1]
  if (
    topLanguage &&
    secondLanguage &&
    topLanguage.percent >= 25 &&
    secondLanguage.percent >= 20 &&
    languageEvidence >= 6
  ) {
    out.push(
      candidate({
        key: 'language-pair',
        scope: 'global',
        category: 'Languages',
        content: `Uses ${languageTitle(topLanguage.label)} and ${languageTitle(secondLanguage.label)} together.`,
        confidence: 0.58,
        evidenceCount: Math.round(topLanguage.weight + secondLanguage.weight)
      })
    )
  }

  for (const census of projectCensus) {
    const total = Object.values(census.byLanguage).reduce((sum, value) => sum + value, 0)
    if (total < 8) continue
    const ranked = Object.entries(census.byLanguage).sort((a, b) => b[1] - a[1])
    const [name, count] = ranked[0] ?? []
    if (!name || name === 'unknown' || count / total < 0.5) continue
    const projectName = projectNames[census.projectId]
    out.push(
      candidate({
        key: `project-language:${census.projectId}`,
        scope: 'project',
        projectId: census.projectId,
        category: 'Languages',
        content: projectName
          ? `${projectName} is primarily ${languageTitle(name)}.`
          : `This project is primarily ${languageTitle(name)}.`,
        confidence: count / total >= 0.7 ? 0.78 : 0.6,
        evidenceCount: count
      })
    )
  }

  for (const census of projectCensus) {
    if (census.frameworks.length === 0) continue
    const names = census.frameworks.slice(0, 3)
    const projectName = projectNames[census.projectId]
    out.push(
      candidate({
        key: `project-stack:${census.projectId}`,
        scope: 'project',
        projectId: census.projectId,
        category: 'Tooling',
        content: projectName
          ? `${projectName} uses ${joinNames(names)}.`
          : `This project uses ${joinNames(names)}.`,
        confidence: names.length >= 2 ? 0.74 : 0.6,
        evidenceCount: names.length
      })
    )
    if (census.frameworks.includes('Electron')) {
      out.push(
        candidate({
          key: `project-kind:${census.projectId}`,
          scope: 'project',
          projectId: census.projectId,
          category: 'Architecture',
          content: projectName ? `${projectName} is an Electron app.` : 'This project is an Electron app.',
          confidence: 0.8,
          evidenceCount: 1
        })
      )
    }
  }

  const strongFrameworks = metrics.frameworks.filter((framework) => framework.evidenceCount >= 3)
  if (strongFrameworks.length > 0) {
    const names = strongFrameworks.slice(0, 3).map((framework) => framework.name)
    const evidence = strongFrameworks.reduce((sum, framework) => sum + framework.evidenceCount, 0)
    out.push(
      candidate({
        key: 'frameworks-core',
        scope: 'global',
        category: 'Tooling',
        content: `Works with ${joinNames(names)}.`,
        confidence: strongFrameworks.some((framework) => framework.confidence === 'high') ? 0.8 : 0.6,
        evidenceCount: evidence
      })
    )
  }

  const topCategory = metrics.workCategories.entries[0]
  const categoryEvidence = metrics.workCategories.entries.reduce((sum, entry) => sum + entry.weight, 0)
  if (topCategory && topCategory.percent >= 40 && categoryEvidence >= 4) {
    out.push(
      candidate({
        key: 'category-primary',
        scope: 'global',
        category: 'Workflow',
        content: `Recent activity is mostly ${topCategory.label.toLowerCase()}.`,
        confidence: topCategory.percent >= 55 ? 0.7 : 0.55,
        evidenceCount: Math.round(topCategory.weight)
      })
    )
  }

  const mostUsed = metrics.workflow.mostUsedAgent
  const agentEvidence = metrics.workflow.providerDistribution.reduce((sum, entry) => sum + entry.weight, 0)
  if (mostUsed && agentEvidence >= 3) {
    out.push(
      candidate({
        key: 'agent-primary',
        scope: 'global',
        category: 'Tooling',
        content: `Most-used agent is ${agentTitle(mostUsed)}.`,
        confidence: 0.68,
        evidenceCount: Math.round(agentEvidence)
      })
    )
  }

  const sequence = metrics.workflow.commonAgentSequence
  if (sequence && sequence.length === 2) {
    out.push(
      candidate({
        key: 'agent-sequence',
        scope: 'global',
        category: 'Workflow',
        content: `Often uses ${agentTitle(sequence[0])} then ${agentTitle(sequence[1])}.`,
        confidence: 0.6,
        evidenceCount: 2
      })
    )
  }

  const topProject = metrics.workflow.mostUsedProject
  const projectEvidence = metrics.workflow.projectDistribution.reduce((sum, entry) => sum + entry.weight, 0)
  if (topProject && projectEvidence >= 4) {
    out.push(
      candidate({
        key: `project-focus:${topProject.id}`,
        scope: 'project',
        projectId: topProject.id,
        category: 'Workflow',
        content: `Most recorded work happens in ${topProject.name}.`,
        confidence: 0.55,
        evidenceCount: Math.round(projectEvidence)
      })
    )
  }

  if (prompts.length > 0) {
    for (const rule of STYLE_RULES) {
      let hits = 0
      for (const record of prompts) {
        if (rule.pattern.test(record.prompt)) hits += 1
      }
      if (hits >= 2) {
        out.push(
          candidate({
            key: rule.key,
            scope: 'global',
            category: rule.category,
            content: rule.content,
            confidence: clampConfidence(0.4 + hits * 0.08),
            evidenceCount: hits
          })
        )
      }
    }
  }

  return out
}

const CONTEXT_CHAR_BUDGET = 3200

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token.length > 2)
}

export function rankMemoriesForContext(
  memories: DeveloperMemory[],
  request: MemoryContextRequest,
  injectionEnabled: boolean
): MemoryContextPackage {
  const queryTokens = new Set(tokenize(request.query ?? ''))
  const limit = Math.min(20, Math.max(1, Math.floor(request.limit ?? 8)))
  const scored: Array<MemoryContextItem & { score: number; lastSeenAt: number }> = []

  for (const memory of memories) {
    if (!memory.enabled) continue
    if (memory.scope === 'project' && (!request.projectId || memory.projectId !== request.projectId)) continue

    let score = memory.scope === 'project' && memory.projectId === request.projectId ? 40 : 15
    score += memory.confidence * 10
    if (memory.source === 'user') score += 12
    const ageDays = (Date.now() - memory.lastSeenAt) / (24 * 60 * 60 * 1000)
    if (ageDays <= 14) score += 10
    else if (ageDays <= 60) score += 5

    if (queryTokens.size > 0) {
      const haystack = new Set(tokenize(`${memory.category} ${memory.content}`))
      let overlap = 0
      for (const token of queryTokens) if (haystack.has(token)) overlap += 1
      score += overlap > 0 ? overlap * 12 : -6
    }

    scored.push({
      id: memory.id,
      scope: memory.scope,
      category: memory.category,
      content: memory.content,
      relevance: Math.round(score),
      score,
      lastSeenAt: memory.lastSeenAt
    })
  }

  scored.sort((a, b) => b.score - a.score || b.lastSeenAt - a.lastSeenAt)

  const selected: MemoryContextItem[] = []
  let characterCount = 0
  let truncated = scored.length > limit
  for (const item of scored) {
    if (selected.length >= limit) {
      truncated = true
      break
    }
    if (characterCount + item.content.length > CONTEXT_CHAR_BUDGET) {
      truncated = true
      break
    }
    selected.push({
      id: item.id,
      scope: item.scope,
      category: item.category,
      content: item.content,
      relevance: item.relevance
    })
    characterCount += item.content.length
  }

  return {
    memories: selected,
    characterCount,
    tokenEstimate: Math.ceil(characterCount / 4),
    truncated,
    injectionEnabled
  }
}
