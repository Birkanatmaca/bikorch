export const OUTPUT_BUFFER_LIMIT = 120_000

type SessionOwner = { projectId?: string; kind: string; accountId?: string; cliModel?: string; cwd: string; worktreePath?: string }

export function hostSessionMatchesRequest(existing: SessionOwner, request: SessionOwner): boolean {
  return existing.projectId === request.projectId && existing.kind === request.kind &&
    existing.accountId === request.accountId && existing.cliModel === request.cliModel &&
    existing.cwd === request.cwd && existing.worktreePath === request.worktreePath
}

export function appendOutputBuffer(
  buffer: string,
  chunk: string,
  limit = OUTPUT_BUFFER_LIMIT
): string {
  if (!chunk) return buffer
  if (chunk.length >= limit) return chunk.slice(-limit)
  if (buffer.length + chunk.length <= limit) return `${buffer}${chunk}`
  return `${buffer}${chunk}`.slice(-limit)
}

export function hostHasRunningSessions(
  sessions: Map<string, { status: string }>
): boolean {
  for (const session of sessions.values()) {
    if (session.status === 'running') return true
  }
  return false
}
