import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import type {
  SecretaryAssignment,
  SecretaryPanelContext,
  SecretaryPlan,
  SecretaryPlanRequest
} from '@shared/contracts/secretary'
import type { CliUsageInfo, CliUsageKind } from '@shared/contracts/usage'

const MAX_ASSIGNMENTS = 8

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
export function routeSecretaryPanel(kind: CliUsageKind, panels: SecretaryPanelContext[], usage: CliUsageInfo[]): string | null {
  const candidates = panels
    .filter((panel) => panel.kind === kind)
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
  const assignedKinds = new Set<CliUsageKind>()
  for (const [index, value] of parsed.assignments.slice(0, MAX_ASSIGNMENTS).entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('The planning response was incomplete')
    }
    const item = value as {
      kind?: unknown
      title?: unknown
      instruction?: unknown
      rationale?: unknown
      usageNote?: unknown
    }
    const kind = typeof item.kind === 'string' && AI_ACCOUNT_KINDS.includes(item.kind as CliUsageKind)
      ? item.kind as CliUsageKind
      : null
    if (!kind || typeof item.instruction !== 'string' || !item.instruction.trim()) {
      throw new Error('The planning response was incomplete')
    }
    if (assignedKinds.has(kind)) {
      throw new Error('The planner assigned more than one task to the same CLI kind')
    }
    if (!isSafeSecretaryInstruction(item.instruction)) {
      throw new Error('The plan contains a disallowed CLI instruction')
    }
    const panelId = routeSecretaryPanel(kind, request.panels, request.usage)
    const routedPanel = panelId ? request.panels.find((panel) => panel.id === panelId) : undefined
    const usedPercent = routedPanel
      ? panelUsedPercent(routedPanel, request.usage)
      : request.usage.find((provider) => provider.kind === kind && !provider.accountId)?.primary?.usedPercent ?? 0
    assignments.push({
      id: `assignment-${index + 1}`,
      panelId,
      kind,
      title: typeof item.title === 'string' && item.title.trim()
        ? item.title.trim().slice(0, 120)
        : `Task ${index + 1}`,
      instruction: item.instruction.trim().slice(0, 6000),
      rationale: typeof item.rationale === 'string'
        ? item.rationale.slice(0, 500)
        : 'Selected by the planner.',
      usageNote: typeof item.usageNote === 'string'
        ? item.usageNote.slice(0, 240)
        : usedPercent >= 80
          ? `Usage looks high (~${Math.round(usedPercent)}%). Still opening this CLI because you asked for it.`
          : 'Review account availability before dispatching.'
    })
    assignedKinds.add(kind)
  }
  if (assignments.length === 0) {
    throw new Error('The planner did not select an available CLI task')
  }
  return {
    overview: parsed.overview.trim().slice(0, 1000),
    assumptions: Array.isArray(parsed.assumptions)
      ? parsed.assumptions.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : [],
    assignments,
    approvalRequired: true
  }
}
