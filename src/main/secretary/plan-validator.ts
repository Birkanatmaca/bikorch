import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import type {
  SecretaryAssignment,
  SecretaryAssignmentMode,
  SecretaryPanelContext,
  SecretaryPlan,
  SecretaryPlanRequest
} from '@shared/contracts/secretary'
import { SECRETARY_ASSIGNMENT_MODES } from '@shared/contracts/secretary'
import type { CliUsageInfo, CliUsageKind } from '@shared/contracts/usage'

const MAX_ASSIGNMENTS = 8
const MAX_ASSIGNMENTS_PER_KIND = 3

function assertAcyclic(assignments: SecretaryAssignment[]): void {
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error('The plan contains a dependency cycle')
    visiting.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const assignment of assignments) visit(assignment.id)
}

const DISALLOWED_CLI_INSTRUCTIONS: RegExp[] = [
  /(?:^|[\n.;])\s*(?:please\s+)?(?:run\s+)?git\s+(?:push|commit|reset\s+--hard|clean\s+-[a-z]*)\b/i,
  /\b(?:rm\s+-rf|rmdir\s+\/s\s+\/q|remove-item\b[^\n]{0,160}-(?:recurse|force))\b/i,
  /(?:^|[\n.;])\s*(?:please\s+)?(?:print|reveal|expose|upload|send|copy)\b[^\n]{0,180}\b(?:api[ _-]?key|secret|token|password)\b/i,
  /\b(?:curl|wget)\b[^\n]{0,300}\|\s*(?:sh|bash|zsh|powershell)\b/i
]

function panelStatusRank(status: SecretaryPanelContext['status']): number {
  if (status === 'waiting') return 0
  if (status === 'running') return 1
  if (status === 'starting') return 2
  if (status === 'busy') return 3
  if (status === 'stopped') return 4
  return 5
}

function panelUsedPercent(panel: SecretaryPanelContext, usage: CliUsageInfo[]): number {
  const match = panel.accountId
    ? usage.find((provider) => provider.accountId === panel.accountId)
    : usage.find((provider) => provider.kind === panel.kind && !provider.accountId)
  return match?.primary?.usedPercent ?? 0
}

/**
 * The model never gets to choose an account or an arbitrary terminal. Pick a
 * compatible existing panel predictably, preferring an idle and less-used one.
 */
export function routeSecretaryPanel(
  kind: CliUsageKind,
  panels: SecretaryPanelContext[],
  usage: CliUsageInfo[],
  excludedPanelIds: ReadonlySet<string> = new Set()
): string | null {
  const candidates = panels
    .filter((panel) => panel.kind === kind && !excludedPanelIds.has(panel.id))
    .sort((left, right) => (
      panelStatusRank(left.status) - panelStatusRank(right.status) ||
      panelUsedPercent(left, usage) - panelUsedPercent(right, usage) ||
      left.id.localeCompare(right.id)
    ))
  return candidates[0]?.id ?? null
}

export function isSafeSecretaryInstruction(instruction: string): boolean {
  return !DISALLOWED_CLI_INSTRUCTIONS.some((pattern) => pattern.test(instruction))
}

/**
 * Converts an untrusted model value into the only plan form the dispatcher may
 * receive. Runtime validation remains necessary even with strict JSON Schema.
 */
export function validateSecretaryPlan(
  raw: unknown,
  request: Pick<SecretaryPlanRequest, 'panels' | 'usage'>,
  required: boolean
): SecretaryPlan | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (required) throw new Error('The planning response was incomplete')
    return null
  }
  const parsed = raw as {
    overview?: unknown
    assumptions?: unknown
    assignments?: unknown
  }
  if (typeof parsed.overview !== 'string' || !parsed.overview.trim() || !Array.isArray(parsed.assignments)) {
    throw new Error('The planning response was incomplete')
  }

  const assignments: SecretaryAssignment[] = []
  const usedPanelIds = new Set<string>()
  const assignmentsByKind = new Map<CliUsageKind, number>()
  const requestedKinds = (parsed.assignments as unknown[]).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const kind = (value as { kind?: unknown }).kind
    return typeof kind === 'string' && AI_ACCOUNT_KINDS.includes(kind as CliUsageKind) ? [kind as CliUsageKind] : []
  })
  for (const [index, value] of parsed.assignments.slice(0, MAX_ASSIGNMENTS).entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('The planning response was incomplete')
    }
    const item = value as {
      kind?: unknown
      mode?: unknown
      title?: unknown
      instruction?: unknown
      expectedResult?: unknown
      rationale?: unknown
      usageNote?: unknown
      dependsOn?: unknown
    }
    const kind = typeof item.kind === 'string' && AI_ACCOUNT_KINDS.includes(item.kind as CliUsageKind)
      ? item.kind as CliUsageKind
      : null
    if (!kind || typeof item.instruction !== 'string' || !item.instruction.trim()) {
      throw new Error('The planning response was incomplete')
    }
    const kindCount = (assignmentsByKind.get(kind) ?? 0) + 1
    if (kindCount > MAX_ASSIGNMENTS_PER_KIND) {
      throw new Error(`The planner assigned too many tasks to the same ${kind} CLI kind`)
    }
    const mode = typeof item.mode === 'string' && SECRETARY_ASSIGNMENT_MODES.includes(item.mode as SecretaryAssignmentMode)
      ? item.mode as SecretaryAssignmentMode
      : 'implement'
    const expectedResult = typeof item.expectedResult === 'string' && item.expectedResult.trim()
      ? item.expectedResult.trim().slice(0, 1_000)
      : mode === 'implement'
        ? 'The requested change is implemented and the relevant verification is reported.'
        : 'A concise, evidence-based result is returned for the assigned task.'
    if (!isSafeSecretaryInstruction(item.instruction) || !isSafeSecretaryInstruction(expectedResult)) {
      throw new Error('The plan contains a disallowed CLI instruction')
    }
    const repeatedKind = requestedKinds.filter((candidate) => candidate === kind).length > 1
    const routingPanels = repeatedKind
      ? request.panels.filter((panel) => panel.status === 'waiting')
      : request.panels
    const panelId = routeSecretaryPanel(kind, routingPanels, request.usage, usedPanelIds)
    if (panelId) usedPanelIds.add(panelId)
    assignmentsByKind.set(kind, kindCount)
    const routedPanel = panelId ? request.panels.find((panel) => panel.id === panelId) : undefined
    const usedPercent = routedPanel
      ? panelUsedPercent(routedPanel, request.usage)
      : request.usage.find((provider) => provider.kind === kind && !provider.accountId)?.primary?.usedPercent ?? 0
    const dependencyIndexes = Array.isArray(item.dependsOn)
      ? item.dependsOn.filter((dependency): dependency is number => Number.isInteger(dependency))
      : []
    const assignmentCount = Math.min((parsed.assignments as unknown[]).length, MAX_ASSIGNMENTS)
    if (dependencyIndexes.some((dependency) => dependency < 0 || dependency >= assignmentCount || dependency === index)) {
      throw new Error('The plan contains an invalid assignment dependency')
    }
    const dependsOn = [...new Set(dependencyIndexes)].map((dependency) => `assignment-${dependency + 1}`)
    assignments.push({
      id: `assignment-${index + 1}`,
      panelId,
      kind,
      mode,
      title: typeof item.title === 'string' && item.title.trim()
        ? item.title.trim().slice(0, 120)
        : `Task ${index + 1}`,
      instruction: item.instruction.trim().slice(0, 6000),
      expectedResult,
      rationale: typeof item.rationale === 'string'
        ? item.rationale.slice(0, 500)
        : 'Selected by the planner.',
      usageNote: typeof item.usageNote === 'string'
        ? item.usageNote.slice(0, 240)
        : usedPercent >= 80
          ? `Usage looks high (~${Math.round(usedPercent)}%). Still opening this CLI because you asked for it.`
          : 'Review account availability before dispatching.',
      dependsOn
    })
  }
  if (assignments.length === 0) {
    throw new Error('The planner did not select an available CLI task')
  }
  assertAcyclic(assignments)
  return {
    overview: parsed.overview.trim().slice(0, 1000),
    assumptions: Array.isArray(parsed.assumptions)
      ? parsed.assumptions.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : [],
    assignments,
    approvalRequired: true
  }
}
