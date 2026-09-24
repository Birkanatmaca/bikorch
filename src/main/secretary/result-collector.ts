import type { PtyEvent } from '@shared/contracts/pty'
import type { GitSessionSnapshot } from '@shared/contracts/git'
import type { SecretaryAssignment, SecretaryCompletionEvidence, SecretaryRun, SecretaryRunAnswerRequest } from '@shared/contracts/secretary'
import { formatCliPaste } from '@shared/cli-prompt'
import { readSecretaryCliResult, wrapSecretaryCliInstruction, type SecretaryCliOutcome } from '@shared/secretary-result-protocol'
import { ptyManager } from '../cli/pty-manager'
import { checkAgentGitPatch, snapshotAgentGit } from '../git/session-snapshot'
import { emitSecretaryEvent } from './events'
import { finalizeSecretaryRun, type SecretaryCliResult } from './service'
import { getSecretaryStore } from './store'
import { releaseSecretaryRunLock } from './run-lock'
import { buildSecretaryRunEvidence } from './evidence'

const OUTPUT_LIMIT = 8_000
const RUN_TIMEOUT_MS = 8 * 60_000

interface Target {
  assignment: SecretaryAssignment
  sessionId: string
  output: string
  sawBusy: boolean
  outcome: SecretaryCliOutcome | null
  completionEvidence: SecretaryCompletionEvidence | null
  summary: string | null
  lastStructuredResult: string | null
  structuredResultCount: number
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
  waitingSessionIds: Set<string>
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
  const [gitEnd, patchCheckExitCode] = await Promise.all([
    snapshotAgentGit(target.cwd, target.gitStart.headSha ?? undefined),
    checkAgentGitPatch(target.cwd)
  ])
  const changedFiles = unique(gitEnd.changedFiles, 80)
  const changed = new Set(changedFiles)
  const reportedChangedFiles = unique(target.reportedChangedFiles, 30)
  return {
    assignmentId: target.assignment.id,
    kind: target.assignment.kind,
    mode: target.assignment.mode,
    title: target.assignment.title,
    expectedResult: target.assignment.expectedResult,
    summary: target.summary ?? stripAnsi(target.output).replace(/\r/g, '').trim().slice(-2_000),
    output: target.output,
    outcome: target.outcome ?? 'failed',
    completionEvidence: target.completionEvidence ?? 'terminal-idle-inferred',
    git: {
      available: Boolean(target.gitStart.headSha || gitEnd.headSha || changedFiles.length || gitEnd.commits.length),
      changedFiles,
      commits: gitEnd.commits.slice(0, 20),
      preexistingChangedFiles: unique(target.gitStart.changedFiles, 80),
      reportedChangedFiles,
      unverifiedReportedFiles: reportedChangedFiles.filter((path) => !changed.has(path)),
      patchCheckExitCode
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
    completionEvidence: null,
    summary: null,
    lastStructuredResult: null,
    structuredResultCount: 0,
    cwd: binding.cwd,
    gitStart: binding.gitStart,
    reportedChangedFiles: []
  }
}

function waitForPasteCommit(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120))
}

function dependencyContext(tracked: TrackedRun, assignment: SecretaryAssignment): string {
  const dependencies = new Set(assignment.dependsOn ?? [])
  if (dependencies.size === 0) return ''
  return [...tracked.targets.values()]
    .filter((target) => dependencies.has(target.assignment.id))
    .map((target) => {
      const summary = target.summary ?? stripAnsi(target.output).replace(/\r/g, '').trim().slice(-1_600)
      const files = target.reportedChangedFiles.length > 0
        ? `\nReported files (not yet verified): ${target.reportedChangedFiles.join(', ')}`
        : ''
      return `[${target.assignment.title} · ${target.assignment.kind}]\n${summary || 'Completed without a structured summary.'}${files}`
    })
    .join('\n\n')
    .slice(0, 5_000)
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
    formatCliPaste(wrapSecretaryCliInstruction(readyBinding.assignment.instruction, {
      mode: readyBinding.assignment.mode,
      expectedResult: readyBinding.assignment.expectedResult,
      dependencyContext: dependencyContext(tracked, readyBinding.assignment)
    }))
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
  const tracked = trackedRuns.get(runId)
  if (!tracked) return
  const activeSessionIds = [...tracked.targets.values()]
    .filter((target) => !target.outcome)
    .map((target) => target.sessionId)
  dropTrackedRun(runId)
  void Promise.all(activeSessionIds.map((sessionId) => ptyManager.writeForSecretary(sessionId, '\u0003').catch(() => undefined)))
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
  if (!tracked || tracked.finalizing) return
  const failedIds = new Set(
    [...tracked.targets.values()]
      .filter((target) => target.outcome === 'failed')
      .map((target) => target.assignment.id)
  )
  if (failedIds.size > 0) {
    failTrackedRun(runId, 'A dependency assignment failed; dependent CLI tasks were not started.')
    return
  }
  const completedIds = new Set(
    [...tracked.targets.values()]
      .filter((target) => target.outcome === 'completed')
      .map((target) => target.assignment.id)
  )
  const ready = tracked.pending.filter((binding) =>
    (binding.assignment.dependsOn ?? []).every((dependency) => completedIds.has(dependency))
  )
  const blocked = tracked.pending.some((binding) =>
    (binding.assignment.dependsOn ?? []).some((dependency) => failedIds.has(dependency))
  )
  if (blocked) {
    failTrackedRun(runId, 'A dependency assignment failed; dependent CLI tasks were not started.')
    return
  }
  if (ready.length > 0) {
    const readyIds = new Set(ready.map((binding) => binding.assignment.id))
    tracked.pending = tracked.pending.filter((binding) => !readyIds.has(binding.assignment.id))
    try {
      for (const next of ready) await dispatchNextStep(tracked, next)
    } catch (cause) {
      failTrackedRun(runId, cause instanceof Error ? cause.message : 'Could not dispatch the next dependent CLI task.')
    }
    return
  }
  if ([...tracked.targets.values()].some((target) => !target.outcome)) return
  if (tracked.pending.length > 0) {
    failTrackedRun(runId, 'The Secretary dependency graph could not make progress.')
    return
  }
  tracked.finalizing = true
  const completed = dropTrackedRun(runId)
  if (!completed) return
  try {
    const planOrder = new Map(completed.run.plan?.assignments.map((assignment, index) => [assignment.id, index]) ?? [])
    const orderedTargets = [...completed.targets.values()].sort((left, right) => (
      (planOrder.get(left.assignment.id) ?? Number.MAX_SAFE_INTEGER) -
      (planOrder.get(right.assignment.id) ?? Number.MAX_SAFE_INTEGER)
    ))
    const results = await Promise.all(orderedTargets.map(toResult))
    const changedFiles = unique(results.flatMap((result) => result.git.changedFiles), 120)
    const unverifiedReportedFiles = unique(results.flatMap((result) => result.git.unverifiedReportedFiles), 80)
    const completionEvidence = {
      cliReported: results.filter((result) => result.completionEvidence === 'cli-reported').length,
      terminalIdleInferred: results.filter((result) => result.completionEvidence === 'terminal-idle-inferred').length
    }
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
        openKinds: result.followUpRun.openKinds,
        completedEvidence: result.completedRun.evidence ?? buildSecretaryRunEvidence(results, [])
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
      completionEvidence,
      panelIds,
      evidence: result.completedRun.evidence ?? buildSecretaryRunEvidence(
        results,
        [...completed.targets.values()].map((target) => ({
          assignmentId: target.assignment.id,
          sessionId: target.sessionId,
          accountId: null
        }))
      )
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
  reportedChangedFiles: string[] = [],
  summary = '',
  completionEvidence: SecretaryCompletionEvidence = 'terminal-idle-inferred'
): void {
  const tracked = trackedRuns.get(runId)
  const target = tracked?.targets.get(sessionId)
  if (!tracked || !target || target.outcome) return
  tracked.waitingSessionIds.delete(sessionId)
  target.outcome = outcome
  target.completionEvidence = completionEvidence
  target.summary = summary.trim() || target.summary
  target.reportedChangedFiles = unique(reportedChangedFiles, 30)
  void finishTrackedRun(runId)
}

function resumeRunIfPaused(runId: string, sessionId: string): void {
  const tracked = trackedRuns.get(runId)
  tracked?.waitingSessionIds.delete(sessionId)
  const store = getSecretaryStore()
  const run = store?.getRun(runId)
  if (store && run?.status === 'needs-user' && tracked?.waitingSessionIds.size === 0) {
    store.updateRun(runId, { status: 'running' })
  }
}

function pauseForUser(runId: string, sessionId: string, message: string): void {
  const tracked = trackedRuns.get(runId)
  if (!tracked) return
  const target = tracked.targets.get(sessionId)
  if (!target) return
  const alreadyWaiting = tracked.waitingSessionIds.has(sessionId)
  tracked.waitingSessionIds.add(sessionId)
  const store = getSecretaryStore()
  const run = store?.getRun(runId)
  if (store && run?.status === 'running') {
    store.updateRun(runId, { status: 'needs-user' })
  }
  if (store && run && !alreadyWaiting) {
    store.appendMessage({
      threadId: run.threadId,
      runId,
      assignmentId: target.assignment.id,
      role: 'assistant',
      type: 'needs-user',
      content: message
    })
  }
  if (!alreadyWaiting) {
    emitSecretaryEvent({
      type: 'run-needs-user',
      projectId: tracked.run.projectId,
      runId,
      assignmentId: target.assignment.id,
      assignmentTitle: target.assignment.title,
      message
    })
  }
}

/** Sends a Secretary chat answer back to the single CLI session waiting for input. */
export async function answerTrackedSecretaryRun(payload: unknown): Promise<SecretaryRun> {
  const request = payload as Partial<SecretaryRunAnswerRequest>
  if (
    typeof request?.runId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(request.runId) ||
    typeof request.projectId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(request.projectId) ||
    (request.assignmentId !== undefined && (typeof request.assignmentId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(request.assignmentId))) ||
    typeof request.message !== 'string' || !request.message.trim() || request.message.length > 4_000
  ) {
    throw new Error('A valid Secretary run and answer are required')
  }
  const tracked = trackedRuns.get(request.runId)
  const store = getSecretaryStore()
  const run = store?.getRun(request.runId)
  if (!tracked || !store || !run || run.projectId !== request.projectId || run.status !== 'needs-user') {
    throw new Error('This Secretary run is no longer waiting for an answer')
  }
  const waiting = [...tracked.waitingSessionIds].filter((sessionId) => (
    !request.assignmentId || tracked.targets.get(sessionId)?.assignment.id === request.assignmentId
  ))
  if (waiting.length === 0) throw new Error('The waiting CLI session is no longer available')
  if (waiting.length > 1) {
    throw new Error('Multiple CLI sessions need input. Answer them in their terminal panels so each response reaches the correct task.')
  }
  const sessionId = waiting[0]
  const target = tracked.targets.get(sessionId)
  if (!target || target.outcome) throw new Error('The waiting CLI session is no longer available')
  const message = request.message.trim()
  await ptyManager.writeForSecretary(sessionId, formatCliPaste(message))
  await waitForPasteCommit()
  if (trackedRuns.get(request.runId) !== tracked) throw new Error('The Secretary run ended before the answer could be sent')
  await ptyManager.writeForSecretary(sessionId, '\r')
  target.sawBusy = false
  tracked.waitingSessionIds.delete(sessionId)
  const updated = tracked.waitingSessionIds.size === 0
    ? store.updateRun(request.runId, { status: 'running' })
    : store.getRun(request.runId)
  if (!updated) throw new Error('Could not resume the Secretary run')
  store.appendMessage({
    threadId: run.threadId,
    runId: run.id,
    assignmentId: target.assignment.id,
    role: 'user',
    type: 'chat',
    content: message
  })
  return updated
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
      const signature = JSON.stringify(structured)
      const resultCount = clean.split('<BIKORCH_RESULT>').length - 1
      if (signature === target.lastStructuredResult && resultCount <= target.structuredResultCount) return
      target.lastStructuredResult = signature
      target.structuredResultCount = resultCount
      if (structured.outcome === 'needs-user') {
        target.summary = structured.summary
        pauseForUser(runId, event.sessionId, structured.needsUser || structured.summary)
        return
      }
      resumeRunIfPaused(runId, event.sessionId)
      completeTarget(runId, event.sessionId, structured.outcome, structured.changedFiles, structured.summary, 'cli-reported')
      return
    }
    const activity = inferActivity(clean)
    if (activity === 'busy') {
      target.sawBusy = true
      resumeRunIfPaused(runId, event.sessionId)
    }
    if (activity === 'waiting' && target.sawBusy) {
      if (tracked.waitingSessionIds.has(event.sessionId)) return
      resumeRunIfPaused(runId, event.sessionId)
      completeTarget(runId, event.sessionId, 'completed')
    }
    return
  }

  if (event.type === 'exit' || (event.type === 'status' && (event.status === 'error' || event.status === 'stopped'))) {
    resumeRunIfPaused(runId, event.sessionId)
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
  const started = bindings.filter((binding) => binding.gitStart)
  const pending = bindings.filter((binding) => !binding.gitStart)
  if (started.length === 0) throw new Error('The Secretary run has no ready assignment')
  for (const binding of started) {
    const gitStart = binding.gitStart
    if (!gitStart) continue
    targets.set(binding.sessionId, toTarget({ ...binding, gitStart }))
    trackedSessions.set(binding.sessionId, run.id)
  }
  const timer = setTimeout(() => {
    failTrackedRun(run.id, 'The CLI did not return a result before the Secretary timeout.')
  }, RUN_TIMEOUT_MS)
  trackedRuns.set(run.id, { run, targets, pending, timer, finalizing: false, waitingSessionIds: new Set() })
}
