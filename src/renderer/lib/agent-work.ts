import type {
  AgentWorktreeKind,
  IsolationFoldSession,
  IsolationLane,
  IsolationOverlap,
  IsolationValidation,
  WorktreeSetupFailure
} from '@shared/contracts/git'
import type { PtySessionStatus } from '@shared/contracts/pty'

export type AgentWorkTone = 'working' | 'ready' | 'review' | 'attention'

export type ApplyPhase = 'preparing' | 'combining' | 'validating' | 'applying' | 'done' | 'failed'

export interface AgentWorkCard {
  id: string
  runId: string
  panelId: string
  kind: AgentWorktreeKind
  title: string
  tone: AgentWorkTone
  statusLabel: string
  detail: string
  summary: string[]
  files: string[]
  conflictPaths: string[]
  overlapPaths: string[]
  overlapLabels: string[]
  attached: boolean
  branch: string
  baseSha: string
  targetBranch: string
  stale: boolean
  canResume: boolean
}

export const APPLY_PHASES: Array<{ id: Exclude<ApplyPhase, 'done' | 'failed'>; label: string }> = [
  { id: 'preparing', label: 'Preparing project' },
  { id: 'combining', label: 'Combining changes' },
  { id: 'validating', label: 'Running validation' },
  { id: 'applying', label: 'Applying to project' }
]

const KIND_LABEL: Record<AgentWorktreeKind, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  codex: 'Codex'
}

export function agentKindLabel(kind: AgentWorktreeKind): string {
  return KIND_LABEL[kind] ?? kind
}

export function fileCountLabel(count: number): string {
  if (count <= 0) return 'No files changed'
  if (count === 1) return '1 file changed'
  return `${count} files changed`
}

export function validationSummary(validation?: IsolationValidation): string | null {
  if (!validation) return null
  if (validation.test && !validation.test.skipped) {
    return validation.test.ok ? 'Tests passed' : 'Tests failed'
  }
  if (validation.typecheck && !validation.typecheck.skipped) {
    return validation.typecheck.ok ? 'Checks passed' : 'Checks failed'
  }
  if (validation.build && !validation.build.skipped) {
    return validation.build.ok ? 'Build passed' : 'Build failed'
  }
  return null
}

export function setupFailureCommand(failure: WorktreeSetupFailure): string {
  return [failure.command, ...failure.args].filter(Boolean).join(' ')
}

export function setupFailureDetail(failure: WorktreeSetupFailure): string {
  const command = setupFailureCommand(failure)
  if (typeof failure.exitCode === 'number') return `${command} exited with code ${failure.exitCode}`
  const first = failure.output.trim().split(/\r?\n/)[0]
  return first || `${command} failed`
}

export function friendlyAgentWorkError(message: string): string {
  const text = message.trim()
  if (!text) return 'Could not apply these changes.'
  if (/nothing to (accept|fold|apply)/i.test(text)) return 'Nothing to apply.'
  if (/moved since this review/i.test(text)) return 'The project changed. Review again, then apply.'
  if (/^Switch to /i.test(text)) return 'The project branch changed. Review again, then apply.'
  if (/Commit or stash/i.test(text)) return 'Save or undo your own edits in the project first.'
  if (/inspect agent copies/i.test(text)) return 'Could not load agent work.'
  if (/^(Fold failed|Accept failed|Sync failed)/i.test(text)) return 'Could not apply these changes.'
  if (/Could not isolate/i.test(text)) return 'Could not open a separate workspace for this agent.'
  return text
}

function overlapsFor(lane: IsolationLane, overlaps: IsolationOverlap[]): IsolationOverlap[] {
  return overlaps.filter((item) => item.panelIds.includes(lane.panelId))
}

function sessionOf(lane: IsolationLane, sessions: Record<string, PtySessionStatus>): PtySessionStatus | undefined {
  return sessions[lane.panelId] ?? (lane.writerLocked ? undefined : sessions[lane.runId])
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function overlapAgentNames(hit: IsolationOverlap, lanes: IsolationLane[]): string[] {
  return unique(
    hit.panelIds
      .map((id) => lanes.find((lane) => lane.panelId === id)?.kind)
      .filter((kind): kind is AgentWorktreeKind => Boolean(kind))
      .map(agentKindLabel)
  )
}

export function overlapChangedLine(names: string[], path: string): string {
  if (names.length <= 1) {
    const who = names[0] ?? 'Another agent'
    return `${who} also changed ${path}`
  }
  if (names.length === 2) return `Both ${names[0]} and ${names[1]} changed ${path}`
  const last = names[names.length - 1]
  return `${names.slice(0, -1).join(', ')}, and ${last} changed ${path}`
}

function conflictDetail(count: number): string {
  if (count <= 0) return 'These changes could not be combined'
  if (count === 1) return '1 change could not be combined'
  return `${count} changes could not be combined`
}

export function buildAgentWorkCards(input: {
  lanes: IsolationLane[]
  overlaps: IsolationOverlap[]
  fold: IsolationFoldSession | null
  sessions: Record<string, PtySessionStatus>
}): AgentWorkCard[] {
  return input.lanes.map((lane) => {
    const hits = overlapsFor(lane, input.overlaps)
    const fold = input.fold?.panelId === lane.panelId && input.fold.status !== 'empty' ? input.fold : null
    const session = sessionOf(lane, input.sessions)
    const conflictPaths = fold?.status === 'conflict' ? fold.conflicts.map((file) => file.path) : []
    const overlapPaths = hits.map((item) => item.path)
    const overlapNames = hits[0] ? overlapAgentNames(hits[0], input.lanes) : []
    const files = fold?.files.length ? fold.files : lane.files
    const busy = session === 'busy' || session === 'starting'
    const live = session === 'running' || session === 'waiting' || busy
    const hasConflict = Boolean(fold?.status === 'conflict') || lane.runStatus === 'conflict'
    const hasOverlap = hits.length > 0 && !hasConflict
    const checks = validationSummary(fold?.validation)

    let tone: AgentWorkTone = 'ready'
    if (hasConflict) tone = 'attention'
    else if (hasOverlap) tone = 'review'
    else if (busy || (lane.attached && live && files.length === 0)) tone = 'working'
    else if (files.length > 0) tone = 'ready'
    else if (lane.attached && live) tone = 'working'
    else tone = 'working'

    let detail = fileCountLabel(files.length)
    if (checks && (tone === 'ready' || tone === 'review')) {
      detail = `${fileCountLabel(files.length)} · ${checks}`
    }
    if (tone === 'working' && files.length === 0) detail = 'Working…'
    if (tone === 'attention') detail = conflictDetail(conflictPaths.length)
    else if (tone === 'review' && hits[0]) {
      detail = overlapChangedLine(overlapNames, hits[0].path)
    }

    let statusLabel = 'Ready'
    if (tone === 'working') statusLabel = 'Working…'
    if (tone === 'review') statusLabel = 'Review recommended'
    if (tone === 'attention') statusLabel = 'Needs attention'
    if (fold?.status === 'clean' && tone === 'ready') statusLabel = 'Ready to apply'

    return {
      id: lane.runId,
      runId: lane.runId,
      panelId: lane.panelId,
      kind: lane.kind,
      title: lane.title,
      tone,
      statusLabel,
      detail,
      summary: lane.summary ?? [],
      files,
      conflictPaths,
      overlapPaths,
      overlapLabels: overlapNames,
      attached: lane.attached,
      branch: lane.branch,
      baseSha: lane.baseSha,
      targetBranch: lane.targetBranch,
      stale: Boolean(fold?.stale),
      canResume: !lane.attached
    }
  })
}

export function groupAgentWork(cards: AgentWorkCard[]): {
  ready: AgentWorkCard[]
  working: AgentWorkCard[]
  review: AgentWorkCard[]
  attention: AgentWorkCard[]
} {
  return {
    ready: cards.filter((card) => card.tone === 'ready'),
    working: cards.filter((card) => card.tone === 'working'),
    review: cards.filter((card) => card.tone === 'review'),
    attention: cards.filter((card) => card.tone === 'attention')
  }
}

export function applyPhaseIndex(phase: ApplyPhase): number {
  if (phase === 'done') return APPLY_PHASES.length
  if (phase === 'failed') return -1
  return APPLY_PHASES.findIndex((item) => item.id === phase)
}
