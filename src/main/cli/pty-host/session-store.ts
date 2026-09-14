export const OUTPUT_BUFFER_LIMIT = 120_000

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
