import type {
  AgentWorktreeKind,
  IsolationFoldSession,
  IsolationLane,
  IsolationOverlap,
  IsolationValidation
} from '@shared/contracts/git'
import type { PtySessionStatus } from '@shared/contracts/pty'

export type AgentWorkTone = 'working' | 'ready' | 'attention'

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
  files: string[]
  conflictPaths: string[]
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
    const overlapLabels = [...new Set(hits.flatMap((item) => item.labels.filter((label) => label !== lane.title)))]
    const files = fold?.files.length ? fold.files : lane.files
    const busy = session === 'busy' || session === 'starting'
    const live = session === 'running' || session === 'waiting' || busy
    const needsAttention =
      Boolean(fold?.status === 'conflict') || hits.length > 0 || lane.runStatus === 'conflict'

    let tone: AgentWorkTone = 'ready'
    if (needsAttention) tone = 'attention'
    else if (busy || (lane.attached && live && files.length === 0)) tone = 'working'
    else if (files.length > 0) tone = 'ready'
    else if (lane.attached && live) tone = 'working'
    else tone = 'working'

    const otherAgent = overlapLabels[0]
    let detail = fileCountLabel(files.length)
    if (tone === 'working' && files.length === 0) detail = 'Working…'
    if (tone === 'attention' && conflictPaths.length > 0) {
      detail =
        conflictPaths.length === 1
          ? `1 file needs attention`
          : `${conflictPaths.length} files need attention`
      if (otherAgent) detail = `Also changed by ${otherAgent}`
    } else if (tone === 'attention' && overlapPaths.length > 0 && otherAgent) {
      detail = `Also changed by ${otherAgent}`
    }

    let statusLabel = 'Ready'
    if (tone === 'working') statusLabel = 'Working…'
    if (tone === 'attention') statusLabel = 'Needs attention'
    if (fold?.status === 'clean') statusLabel = 'Ready to apply'

    return {
      id: lane.runId,
      runId: lane.runId,
      panelId: lane.panelId,
      kind: lane.kind,
      title: lane.title,
      tone,
      statusLabel,
      detail,
      files,
      conflictPaths: conflictPaths.length > 0 ? conflictPaths : overlapPaths,
      overlapLabels,
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
  attention: AgentWorkCard[]
} {
  return {
    ready: cards.filter((card) => card.tone === 'ready'),
    working: cards.filter((card) => card.tone === 'working'),
    attention: cards.filter((card) => card.tone === 'attention')
  }
}

export function applyPhaseIndex(phase: ApplyPhase): number {
  if (phase === 'done') return APPLY_PHASES.length
  if (phase === 'failed') return -1
  return APPLY_PHASES.findIndex((item) => item.id === phase)
}
