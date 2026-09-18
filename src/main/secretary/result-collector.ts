import type { PtyEvent } from '@shared/contracts/pty'
import type { SecretaryAssignment, SecretaryRun } from '@shared/contracts/secretary'
import { readSecretaryCliResult, type SecretaryCliOutcome } from '@shared/secretary-result-protocol'
import { ptyManager } from '../cli/pty-manager'
import { emitSecretaryEvent } from './events'
import { finalizeSecretaryRun, type SecretaryCliResult } from './service'
import { getSecretaryStore } from './store'

const OUTPUT_LIMIT = 8_000
const RUN_TIMEOUT_MS = 8 * 60_000

interface Target {
  assignment: SecretaryAssignment
  sessionId: string
  output: string
  sawBusy: boolean
  outcome: SecretaryCliOutcome | null
}

interface TrackedRun {
  run: SecretaryRun
  targets: Map<string, Target>
  timer: ReturnType<typeof setTimeout>
  finalizing: boolean
}

const trackedRuns = new Map<string, TrackedRun>()
const trackedSessions = new Map<string, string>()
let unsubscribe: (() => void) | null = null

function stripAnsi(value: string): string {
  return value.replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

function looksWorkspaceTrustPrompt(buffer: string): boolean {
  return /workspace trust required|trust this workspace|do you trust the (?:files|contents) of this directory/i.test(buffer)
}

function inferActivity(buffer: string): 'waiting' | 'busy' | null {
  const tail = stripAnsi(buffer).replace(/\r/g, '').slice(-1_200)
  if (!tail.trim() || looksWorkspaceTrustPrompt(tail)) return null
  if (/(?:^|\n)\s*(?:>|❯|▶|▸|➤|➜)\s*$/.test(tail) || /(?:ask|message|prompt)\s*(?:the\s+)?(?:agent|model|assistant)?\s*$/i.test(tail)) {
    return 'waiting'
  }
  if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒]/.test(tail) || /\b(thinking|generating|searching|analyzing|planning)\b|[✶✻]/i.test(tail)) {
    return 'busy'
  }
  return null
}

function toResult(target: Target): SecretaryCliResult {
  return {
    kind: target.assignment.kind,
    title: target.assignment.title,
    output: target.output,
    outcome: target.outcome ?? 'failed'
  }
}

function dropTrackedRun(runId: string): TrackedRun | null {
  const tracked = trackedRuns.get(runId) ?? null
  if (!tracked) return null
  clearTimeout(tracked.timer)
  trackedRuns.delete(runId)
  for (const target of tracked.targets.values()) trackedSessions.delete(target.sessionId)
  return tracked
}

function failTrackedRun(runId: string, message: string): void {
  const tracked = dropTrackedRun(runId)
  if (!tracked) return
  const store = getSecretaryStore()
  const current = store?.getRun(runId)
  if (store && (current?.status === 'running' || current?.status === 'needs-user')) {
    store.updateRun(runId, { status: 'failed', errorCode: 'CLI_RESULT_COLLECTION_FAILED', errorMessage: message })
    store.appendMessage({ threadId: current.threadId, runId, role: 'assistant', type: 'error', content: message })
  }
  emitSecretaryEvent({ type: 'run-failed', projectId: tracked.run.projectId, runId, message })
}

async function finishTrackedRun(runId: string): Promise<void> {
  const tracked = trackedRuns.get(runId)
  if (!tracked || tracked.finalizing || [...tracked.targets.values()].some((target) => !target.outcome)) return
  tracked.finalizing = true
  const completed = dropTrackedRun(runId)
  if (!completed) return
  try {
    const result = await finalizeSecretaryRun(runId, [...completed.targets.values()].map(toResult))
    if (result.followUpRun?.plan) {
      emitSecretaryEvent({
        type: 'run-followup',
        projectId: result.completedRun.projectId,
        completedRunId: result.completedRun.id,
        runId: result.followUpRun.id,
        reply: result.followUpRun.reply ?? 'A follow-up plan is ready for review.',
        plan: result.followUpRun.plan,
        openKinds: result.followUpRun.openKinds
      })
      return
    }
    emitSecretaryEvent({
      type: 'run-report',
      projectId: result.completedRun.projectId,
      runId: result.completedRun.id,
      reply: result.completedRun.reply ?? 'CLI work completed.'
    })
  } catch {
    const message = 'The CLI finished, but Secretary could not prepare the final report.'
    const store = getSecretaryStore()
    const current = store?.getRun(runId)
    if (store && (current?.status === 'running' || current?.status === 'needs-user')) {
      store.updateRun(runId, { status: 'failed', errorCode: 'CLI_FINAL_REPORT_FAILED', errorMessage: message })
      store.appendMessage({ threadId: current.threadId, runId, role: 'assistant', type: 'error', content: message })
    }
    emitSecretaryEvent({ type: 'run-failed', projectId: completed.run.projectId, runId, message })
  }
}

function completeTarget(runId: string, sessionId: string, outcome: SecretaryCliOutcome): void {
  const tracked = trackedRuns.get(runId)
  const target = tracked?.targets.get(sessionId)
  if (!tracked || !target || target.outcome) return
  target.outcome = outcome
  void finishTrackedRun(runId)
}

function resumeRunIfPaused(runId: string): void {
  const store = getSecretaryStore()
  const run = store?.getRun(runId)
  if (store && run?.status === 'needs-user') store.updateRun(runId, { status: 'running' })
}

function pauseForUser(runId: string, message: string): void {
  const tracked = trackedRuns.get(runId)
  if (!tracked) return
  const store = getSecretaryStore()
  const run = store?.getRun(runId)
  if (store && run?.status === 'running') {
    store.updateRun(runId, { status: 'needs-user' })
    store.appendMessage({ threadId: run.threadId, runId, role: 'assistant', type: 'needs-user', content: message })
  }
  emitSecretaryEvent({ type: 'run-needs-user', projectId: tracked.run.projectId, runId, message })
}

function handlePtyEvent(event: PtyEvent): void {
  const runId = trackedSessions.get(event.sessionId)
  if (!runId) return
  const tracked = trackedRuns.get(runId)
  const target = tracked?.targets.get(event.sessionId)
  if (!tracked || !target) return

  if (event.type === 'data') {
    target.output = `${target.output}${event.data}`.slice(-OUTPUT_LIMIT)
    const clean = stripAnsi(target.output)
    if (looksWorkspaceTrustPrompt(clean)) {
      failTrackedRun(runId, 'The CLI is waiting for workspace trust. Review it in the terminal, then create a fresh plan.')
      return
    }
    const structured = readSecretaryCliResult(clean)
    if (structured) {
      if (structured.outcome === 'needs-user') {
        pauseForUser(runId, structured.needsUser || structured.summary)
        return
      }
      resumeRunIfPaused(runId)
      completeTarget(runId, event.sessionId, structured.outcome)
      return
    }
    const activity = inferActivity(clean)
    if (activity === 'busy') {
      target.sawBusy = true
      resumeRunIfPaused(runId)
    }
    if (activity === 'waiting' && target.sawBusy) {
      resumeRunIfPaused(runId)
      completeTarget(runId, event.sessionId, 'completed')
    }
    return
  }

  if (event.type === 'exit' || (event.type === 'status' && (event.status === 'error' || event.status === 'stopped'))) {
    resumeRunIfPaused(runId)
    completeTarget(runId, event.sessionId, 'failed')
  }
}

/** Binds a single main-process observer for terminal results. Safe to call more than once. */
export function initSecretaryResultCollector(): void {
  if (unsubscribe) return
  unsubscribe = ptyManager.observe(handlePtyEvent)
}

/** Starts collecting only after the durable approved prompts have been sent. */
export function trackSecretaryRun(run: SecretaryRun, bindings: Array<{ assignment: SecretaryAssignment; sessionId: string }>): void {
  initSecretaryResultCollector()
  dropTrackedRun(run.id)
  const targets = new Map<string, Target>()
  for (const binding of bindings) {
    targets.set(binding.sessionId, {
      assignment: binding.assignment,
      sessionId: binding.sessionId,
      output: '',
      sawBusy: false,
      outcome: null
    })
    trackedSessions.set(binding.sessionId, run.id)
  }
  const timer = setTimeout(() => {
    failTrackedRun(run.id, 'The CLI did not return a result before the Secretary timeout.')
  }, RUN_TIMEOUT_MS)
  trackedRuns.set(run.id, { run, targets, timer, finalizing: false })
}
