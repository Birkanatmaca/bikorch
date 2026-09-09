import type {
  DeveloperEventInput,
  RecordPromptRequest,
  RecordPromptResponse,
  SessionCloseReason,
  SessionContextItem,
  SessionStartedPayload
} from '@shared/contracts/developer-intelligence'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'

function uniqueContext(items: SessionContextItem[]): SessionContextItem[] {
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

/**
 * Fire-and-forget emitters for the Developer Intelligence activity stream.
 * The main process applies privacy settings again; the checks here only avoid needless IPC
 * (and avoid sending prompt text at all when history is disabled).
 */

function api(): Window['api']['developerIntelligence'] | null {
  return typeof window !== 'undefined' && window.api?.developerIntelligence
    ? window.api.developerIntelligence
    : null
}

function historyEnabled(): boolean {
  const { settings, settingsLoaded } = useDeveloperIntelligenceStore.getState()
  return settingsLoaded ? settings.keepActivityHistory : true
}

export function recordDeveloperEvent(event: DeveloperEventInput): void {
  const bridge = api()
  if (!bridge || !historyEnabled()) return
  bridge
    .recordEvent(event)
    .then(() => useDeveloperIntelligenceStore.getState().noteActivity())
    .catch(() => undefined)
}

// --- Agent session tracking ------------------------------------------------
// Sessions outlive the TerminalView component (switching projects unmounts the view but
// keeps the PTY alive), so the bookkeeping lives at module level.

interface TrackedSession {
  startedAt: number
  promptCount: number
  kind: SessionStartedPayload['kind']
  projectId?: string
  accountId?: string
  worktreePath?: string
  headSha?: string
  injectedContext: SessionContextItem[]
}

const trackedSessions = new Map<string, TrackedSession>()
const pendingFinalize = new Map<string, Promise<void>>()

export function beginAgentSession(
  sessionId: string,
  meta: {
    kind: SessionStartedPayload['kind']
    projectId?: string
    accountId?: string
    launchMode?: 'normal' | 'login'
    worktreePath?: string
    headSha?: string
  }
): void {
  if (trackedSessions.has(sessionId)) return
  trackedSessions.set(sessionId, {
    startedAt: Date.now(),
    promptCount: 0,
    kind: meta.kind,
    injectedContext: [],
    ...(meta.projectId ? { projectId: meta.projectId } : {}),
    ...(meta.accountId ? { accountId: meta.accountId } : {}),
    ...(meta.worktreePath ? { worktreePath: meta.worktreePath } : {}),
    ...(meta.headSha ? { headSha: meta.headSha } : {})
  })
  recordDeveloperEvent({
    type: 'agent.session.started',
    sessionId,
    provider: meta.kind,
    ...(meta.projectId ? { projectId: meta.projectId } : {}),
    ...(meta.accountId ? { accountId: meta.accountId } : {}),
    payload: {
      kind: meta.kind,
      launchMode: meta.launchMode ?? 'normal',
      ...(meta.worktreePath ? { worktreePath: meta.worktreePath } : {}),
      ...(meta.headSha ? { headSha: meta.headSha } : {})
    }
  })
}

export function notePromptInSession(sessionId: string): void {
  const tracked = trackedSessions.get(sessionId)
  if (tracked) tracked.promptCount += 1
}

export function noteSessionContext(sessionId: string, items: SessionContextItem[]): void {
  const tracked = trackedSessions.get(sessionId)
  if (!tracked || items.length === 0) return
  tracked.injectedContext = uniqueContext([...tracked.injectedContext, ...items])
}

export function resumeAgentSession(
  sessionId: string,
  meta: {
    kind: SessionStartedPayload['kind']
    projectId?: string
    accountId?: string
    worktreePath?: string
    headSha?: string
  }
): void {
  if (trackedSessions.has(sessionId)) return
  trackedSessions.set(sessionId, {
    startedAt: Date.now(),
    promptCount: 0,
    kind: meta.kind,
    injectedContext: [],
    ...(meta.projectId ? { projectId: meta.projectId } : {}),
    ...(meta.accountId ? { accountId: meta.accountId } : {}),
    ...(meta.worktreePath ? { worktreePath: meta.worktreePath } : {}),
    ...(meta.headSha ? { headSha: meta.headSha } : {})
  })
}

export function isAgentSessionTracked(sessionId: string): boolean {
  return trackedSessions.has(sessionId)
}

export function endAgentSession(
  sessionId: string,
  exitCode: number | null,
  closeReason: SessionCloseReason = 'closed'
): void {
  void finalizeAgentSession(sessionId, exitCode, closeReason)
}

export async function finalizeAgentSession(
  sessionId: string,
  exitCode: number | null,
  closeReason: SessionCloseReason = 'closed'
): Promise<void> {
  const pending = pendingFinalize.get(sessionId)
  if (pending) return pending

  const tracked = trackedSessions.get(sessionId)
  if (!tracked) return

  const run = (async (): Promise<void> => {
    let changedFiles: string[] = []
    let commits: Array<{ shortHash: string; subject: string }> = []
    let headSha = tracked.headSha
    if (tracked.worktreePath && window.api?.git?.sessionSnapshot) {
      try {
        const snapshot = await window.api.git.sessionSnapshot({
          cwd: tracked.worktreePath,
          ...(tracked.headSha ? { sinceSha: tracked.headSha } : {})
        })
        changedFiles = snapshot.changedFiles
        commits = snapshot.commits
        headSha = snapshot.headSha ?? tracked.headSha
      } catch {
        // snapshot is best-effort
      }
    }

    trackedSessions.delete(sessionId)
    recordDeveloperEvent({
      type: 'agent.session.ended',
      sessionId,
      provider: tracked.kind,
      ...(tracked.projectId ? { projectId: tracked.projectId } : {}),
      ...(tracked.accountId ? { accountId: tracked.accountId } : {}),
      payload: {
        kind: tracked.kind,
        durationMs: Math.max(0, Date.now() - tracked.startedAt),
        promptCount: tracked.promptCount,
        exitCode,
        closeReason,
        ...(tracked.injectedContext.length > 0 ? { injectedContext: tracked.injectedContext } : {}),
        ...(changedFiles.length > 0 ? { changedFiles } : {}),
        ...(commits.length > 0 ? { commits } : {}),
        ...(headSha ? { headSha } : {})
      }
    })
  })()

  pendingFinalize.set(sessionId, run)
  try {
    await run
  } finally {
    pendingFinalize.delete(sessionId)
  }
}

export async function recordPromptSent(
  request: RecordPromptRequest
): Promise<RecordPromptResponse | null> {
  const bridge = api()
  if (!bridge || !historyEnabled()) return null
  try {
    const response = await bridge.recordPrompt(request)
    useDeveloperIntelligenceStore.getState().noteActivity()
    return response
  } catch {
    return null
  }
}
