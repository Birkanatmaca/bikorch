import type {
  DeveloperEventInput,
  RecordPromptRequest,
  RecordPromptResponse,
  SessionStartedPayload
} from '@shared/contracts/developer-intelligence'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'

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
}

const trackedSessions = new Map<string, TrackedSession>()

export function beginAgentSession(
  sessionId: string,
  meta: {
    kind: SessionStartedPayload['kind']
    projectId?: string
    accountId?: string
    launchMode?: 'normal' | 'login'
  }
): void {
  if (trackedSessions.has(sessionId)) return
  trackedSessions.set(sessionId, {
    startedAt: Date.now(),
    promptCount: 0,
    kind: meta.kind,
    ...(meta.projectId ? { projectId: meta.projectId } : {}),
    ...(meta.accountId ? { accountId: meta.accountId } : {})
  })
  recordDeveloperEvent({
    type: 'agent.session.started',
    sessionId,
    provider: meta.kind,
    ...(meta.projectId ? { projectId: meta.projectId } : {}),
    ...(meta.accountId ? { accountId: meta.accountId } : {}),
    payload: { kind: meta.kind, launchMode: meta.launchMode ?? 'normal' }
  })
}

export function notePromptInSession(sessionId: string): void {
  const tracked = trackedSessions.get(sessionId)
  if (tracked) tracked.promptCount += 1
}

export function isAgentSessionTracked(sessionId: string): boolean {
  return trackedSessions.has(sessionId)
}

export function endAgentSession(sessionId: string, exitCode: number | null): void {
  const tracked = trackedSessions.get(sessionId)
  if (!tracked) return
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
      exitCode
    }
  })
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
