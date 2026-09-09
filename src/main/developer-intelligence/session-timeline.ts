import type {
  AgentSessionSummary,
  DeveloperEvent,
  SessionCloseReason,
  SessionCommitItem,
  SessionContextItem
} from '@shared/contracts/developer-intelligence'

export interface PairedAgentSession {
  id: string
  sessionId: string
  startedAt: number
  endedAt?: number
  start: Extract<DeveloperEvent, { type: 'agent.session.started' }>
  end?: Extract<DeveloperEvent, { type: 'agent.session.ended' }>
}

export function sessionRecordId(sessionId: string, startedAt: number): string {
  return `${sessionId}:${startedAt}`
}

export function parseSessionRecordId(id: string): { sessionId: string; startedAt: number } | null {
  const index = id.lastIndexOf(':')
  if (index <= 0) return null
  const startedAt = Number(id.slice(index + 1))
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null
  const sessionId = id.slice(0, index)
  if (!sessionId) return null
  return { sessionId, startedAt }
}

export function pairAgentSessions(events: DeveloperEvent[]): PairedAgentSession[] {
  const started = events
    .filter((event): event is Extract<DeveloperEvent, { type: 'agent.session.started' }> => event.type === 'agent.session.started')
    .sort((a, b) => a.occurredAt - b.occurredAt)
  const ended = events
    .filter((event): event is Extract<DeveloperEvent, { type: 'agent.session.ended' }> => event.type === 'agent.session.ended')
    .sort((a, b) => a.occurredAt - b.occurredAt)

  const usedEnded = new Set<string>()
  const pairs: PairedAgentSession[] = []

  for (const start of started) {
    const sessionId = start.sessionId
    if (!sessionId) continue
    const end = ended.find((candidate) => {
      if (
        candidate.sessionId !== sessionId ||
        candidate.occurredAt < start.occurredAt ||
        usedEnded.has(candidate.id)
      ) {
        return false
      }
      const interrupted = started.some(
        (other) =>
          other.sessionId === sessionId &&
          other.occurredAt > start.occurredAt &&
          other.occurredAt <= candidate.occurredAt
      )
      return !interrupted
    })
    if (end) usedEnded.add(end.id)
    pairs.push({
      id: sessionRecordId(sessionId, start.occurredAt),
      sessionId,
      startedAt: start.occurredAt,
      ...(end ? { endedAt: end.occurredAt } : {}),
      start,
      ...(end ? { end } : {})
    })
  }

  return pairs.sort((a, b) => b.startedAt - a.startedAt)
}

export function toSessionSummary(pair: PairedAgentSession, now = Date.now()): AgentSessionSummary {
  const kind = pair.end?.payload.kind ?? pair.start.payload.kind
  const durationMs = pair.endedAt
    ? Math.max(0, pair.endedAt - pair.startedAt)
    : Math.max(0, now - pair.startedAt)
  const promptCount = pair.end?.payload.promptCount ?? 0
  const closeReason: SessionCloseReason | undefined = pair.end?.payload.closeReason
  return {
    id: pair.id,
    sessionId: pair.sessionId,
    kind,
    ...(pair.start.projectId ? { projectId: pair.start.projectId } : {}),
    startedAt: pair.startedAt,
    ...(pair.endedAt ? { endedAt: pair.endedAt } : {}),
    durationMs,
    promptCount,
    stillOpen: !pair.end,
    ...(closeReason ? { closeReason } : {}),
    fileCount: pair.end?.payload.changedFiles?.length ?? 0,
    commitCount: pair.end?.payload.commits?.length ?? 0
  }
}

export function uniqueContext(items: SessionContextItem[]): SessionContextItem[] {
  const seen = new Set<string>()
  const next: SessionContextItem[] = []
  for (const item of items) {
    const key = `${item.category}:${item.preview}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
    if (next.length >= 12) break
  }
  return next
}

export function parseCommitLog(raw: string): SessionCommitItem[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .flatMap((line) => {
      const [shortHash, ...subjectParts] = line.split('\x1f')
      const subject = subjectParts.join('\x1f').trim()
      if (!shortHash || !subject) return []
      return [{ shortHash: shortHash.slice(0, 12), subject: subject.slice(0, 200) }]
    })
}

export function parsePorcelainPaths(raw: string): string[] {
  const paths: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.length < 4) continue
    let filePath = line.slice(3).trim()
    if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').pop()?.trim() ?? filePath
    if (filePath.startsWith('"') && filePath.endsWith('"')) filePath = filePath.slice(1, -1)
    filePath = filePath.replace(/\\/g, '/')
    if (filePath && !paths.includes(filePath)) paths.push(filePath)
    if (paths.length >= 80) break
  }
  return paths
}
