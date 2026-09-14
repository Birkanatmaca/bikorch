import type { AgentRunRecord, AgentRunStatus } from '@shared/contracts/git'

const LEGACY: Record<string, AgentRunStatus> = {
  active: 'running',
  queued: 'awaiting-review',
  integrating: 'awaiting-review',
  accepted: 'merged'
}

export function normalizeAgentRunStatus(value: unknown): AgentRunStatus {
  if (typeof value === 'string' && value in LEGACY) return LEGACY[value]
  if (
    value === 'running' ||
    value === 'interrupted' ||
    value === 'awaiting-review' ||
    value === 'conflict' ||
    value === 'merged' ||
    value === 'abandoned' ||
    value === 'parked'
  ) {
    return value
  }
  return 'interrupted'
}

export function isTerminalAgentRunStatus(status: AgentRunStatus): boolean {
  return status === 'merged' || status === 'abandoned'
}

export function isFoldingAgentRunStatus(status: AgentRunStatus): boolean {
  return status === 'awaiting-review' || status === 'conflict'
}

export function buildResumeContext(input: {
  run: Pick<AgentRunRecord, 'title' | 'kind' | 'branch' | 'targetBranch' | 'baseSha' | 'status'>
  files: string[]
  headSha?: string
  lastCheckpointSha?: string | null
}): string {
  const files = input.files.slice(0, 12)
  const extra = input.files.length - files.length
  const fileLines = files.map((file) => `- ${file}`)
  if (extra > 0) fileLines.push(`- … ${extra} more`)
  return [
    '[Bikorch] Resume context — previous chat is gone. Continue from Git, not conversation history.',
    `Task: ${input.run.title}`,
    `CLI: ${input.run.kind}`,
    `Status: ${input.run.status}`,
    `Branch: ${input.run.branch}`,
    `Target: ${input.run.targetBranch || 'current HEAD'}`,
    `Base: ${input.run.baseSha.slice(0, 12) || 'unknown'}`,
    input.headSha ? `HEAD: ${input.headSha.slice(0, 12)}` : '',
    input.lastCheckpointSha ? `Checkpoint: ${input.lastCheckpointSha.slice(0, 12)}` : '',
    fileLines.length > 0 ? 'Changed files:' : 'No unmerged file changes versus the target.',
    ...fileLines
  ]
    .filter(Boolean)
    .join('\n')
}
