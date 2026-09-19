import type { PtyEvent } from '@shared/contracts/pty'
import type { GitSessionSnapshot } from '@shared/contracts/git'
import type { SecretaryAssignment, SecretaryRun } from '@shared/contracts/secretary'
import { formatCliPaste } from '@shared/cli-prompt'
import { readSecretaryCliResult, wrapSecretaryCliInstruction, type SecretaryCliOutcome } from '@shared/secretary-result-protocol'
import { ptyManager } from '../cli/pty-manager'
import { snapshotAgentGit } from '../git/session-snapshot'
import { emitSecretaryEvent } from './events'
import { finalizeSecretaryRun, type SecretaryCliResult } from './service'
import { getSecretaryStore } from './store'
import { releaseSecretaryRunLock } from './run-lock'

const OUTPUT_LIMIT = 8_000
const RUN_TIMEOUT_MS = 8 * 60_000

interface Target {
  assignment: SecretaryAssignment
  sessionId: string
  output: string
  sawBusy: boolean
  outcome: SecretaryCliOutcome | null
  cwd: string
  gitStart: GitSessionSnapshot
  reportedChangedFiles: string[]
}

interface TrackedRun {
  run: SecretaryRun
  targets: Map<string, Target>
  pending: Array<{ assignment: SecretaryAssignment; sessionId: string; cwd: string; gitStart: GitSessionSnapshot | null }>
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

function unique(values: string[], limit: number): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit)
}

async function toResult(target: Target): Promise<SecretaryCliResult> {
  const gitEnd = await snapshotAgentGit(target.cwd, target.gitStart.headSha ?? undefined)
  const changedFiles = unique(gitEnd.changedFiles, 80)
  const changed = new Set(changedFiles)
  const reportedChangedFiles = unique(target.reportedChangedFiles, 30)
  return {
    kind: target.assignment.kind,
    title: target.assignment.title,
    output: target.output,
    outcome: target.outcome ?? 'failed',
    git: {
      available: Boolean(target.gitStart.headSha || gitEnd.headSha || changedFiles.length || gitEnd.commits.length),
      changedFiles,
      commits: gitEnd.commits.slice(0, 20),
      preexistingChangedFiles: unique(target.gitStart.changedFiles, 80),
      reportedChangedFiles,
      unverifiedReportedFiles: reportedChangedFiles.filter((path) => !changed.has(path))
    }
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

function toTarget(binding: { assignment: SecretaryAssignment; sessionId: string; cwd: string; gitStart: GitSessionSnapshot }): Target {
  return {
    assignment: binding.assignment,
    sessionId: binding.sessionId,
    output: '',
    sawBusy: false,
    outcome: null,
    cwd: binding.cwd,
    gitStart: binding.gitStart,
    reportedChangedFiles: []
  }
}

function waitForPasteCommit(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120))
}

async function dispatchNextStep(
  tracked: TrackedRun,
  binding: { assignment: SecretaryAssignment; sessionId: string; cwd: string; gitStart: GitSessionSnapshot | null }
): Promise<void> {
  const readyBinding = {
    ...binding,
    gitStart: binding.gitStart ?? await snapshotAgentGit(binding.cwd)
  }
  tracked.targets.set(readyBinding.sessionId, toTarget(readyBinding))
  trackedSessions.set(readyBinding.sessionId, tracked.run.id)
  await ptyManager.writeForSecretary(
    readyBinding.sessionId,
    formatCliPaste(wrapSecretaryCliInstruction(readyBinding.assignment.instruction))
  )
  await waitForPasteCommit()
  if (trackedRuns.get(tracked.run.id) !== tracked) return
  await ptyManager.writeForSecretary(readyBinding.sessionId, '\r')
}

/** Stops observation before a cancellation interrupts the underlying terminal. */
export function cancelTrackedSecretaryRun(runId: string): string[] {
  const tracked = dropTrackedRun(runId)
  if (!tracked) return []
  releaseSecretaryRunLock(runId)
  return [...tracked.targets.values()].map((target) => target.sessionId)
}

function failTrackedRun(runId: string, message: string): void {
  const tracked = dropTrackedRun(runId)
  if (!tracked) return
  releaseSecretaryRunLock(runId)
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
  const next = tracked.pending.shift()
  if (next) {
    try {
      await dispatchNextStep(tracked, next)
    } catch (cause) {
      failTrackedRun(runId, cause instanceof Error ? cause.message : 'Could not dispatch the next dependent CLI task.')
    }
    return
  }
  tracked.finalizing = true
  const completed = dropTrackedRun(runId)
  if (!completed) return
  try {
    const results = await Promise.all([...completed.targets.values()].map(toResult))
    const changedFiles = unique(results.flatMap((result) => result.git.changedFiles), 120)
    const unverifiedReportedFiles = unique(results.flatMap((result) => result.git.unverifiedReportedFiles), 80)
    const panelIds = unique([...completed.targets.values()].map((target) => target.sessionId), 8)
    const result = await finalizeSecretaryRun(runId, results)
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
      reply: result.completedRun.reply ?? 'CLI work completed.',
      changedFiles,
      unverifiedReportedFiles,
      panelIds
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
  } finally {
    // Keep project/session ownership until the final report event has been
    // persisted and emitted; a new run must not race finalization.
    releaseSecretaryRunLock(runId)
  }
}

function completeTarget(
  runId: string,
  sessionId: string,
  outcome: SecretaryCliOutcome,
  reportedChangedFiles: string[] = []
): void {
  const tracked = trackedRuns.get(runId)
  const target = tracked?.targets.get(sessionId)
  if (!tracked || !target || target.outcome) return
  target.outcome = outcome
  target.reportedChangedFiles = unique(reportedChangedFiles, 30)
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
      completeTarget(runId, event.sessionId, structured.outcome, structured.changedFiles)
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
export function trackSecretaryRun(
  run: SecretaryRun,
  bindings: Array<{ assignment: SecretaryAssignment; sessionId: string; cwd: string; gitStart: GitSessionSnapshot | null }>
): void {
  initSecretaryResultCollector()
  dropTrackedRun(run.id)
  const targets = new Map<string, Target>()
  const [first, ...pending] = bindings
  if (first) {
    const gitStart = first.gitStart
    if (!gitStart) throw new Error('The first Secretary assignment is missing its Git baseline')
    targets.set(first.sessionId, toTarget({ ...first, gitStart }))
    trackedSessions.set(first.sessionId, run.id)
  }
  const timer = setTimeout(() => {
    failTrackedRun(run.id, 'The CLI did not return a result before the Secretary timeout.')
  }, RUN_TIMEOUT_MS)
  trackedRuns.set(run.id, { run, targets, pending, timer, finalizing: false })
}
