import { formatCliPaste } from '@shared/cli-prompt'
import { wrapSecretaryCliInstruction } from '@shared/secretary-result-protocol'
import type {
  SecretaryRun,
  SecretaryRunDispatchRequest,
  SecretaryRunDispatchResult,
  SecretaryRunPreparationResult
} from '@shared/contracts/secretary'
import { isSameFilePath } from '../cli/path-validator'
import { ptyManager, type PtySessionSnapshot } from '../cli/pty-manager'
import { snapshotAgentGit } from '../git/session-snapshot'
import { isRegisteredAgentWorktree } from '../git/worktrees'
import { canonicalRepoRoot } from '../git/worktree-paths'
import { flushPersistenceToDisk, loadSnapshot } from '../persistence/database'
import { getSecretaryStore } from './store'
import { cancelTrackedSecretaryRun, trackSecretaryRun } from './result-collector'
import { releaseSecretaryRunLock, reserveSecretaryRunLock } from './run-lock'

const SUBMIT_DELAY_MS = 120

function validId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

function parseDispatchRequest(payload: unknown): SecretaryRunDispatchRequest {
  if (!payload || typeof payload !== 'object') throw new Error('A run and CLI sessions are required')
  const request = payload as Partial<SecretaryRunDispatchRequest>
  const assignments = Array.isArray(request.assignments) ? request.assignments : []
  return {
    runId: validId(request.runId, 'run ID'),
    projectId: validId(request.projectId, 'project ID'),
    assignments: assignments.map((assignment) => {
      if (!assignment || typeof assignment !== 'object') throw new Error('Invalid CLI session binding')
      const item = assignment as { assignmentId?: unknown; sessionId?: unknown }
      return {
        assignmentId: validId(item.assignmentId, 'assignment ID'),
        sessionId: validId(item.sessionId, 'session ID')
      }
    })
  }
}

function waitForPasteCommit(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS))
}

function samePath(left: string, right: string): boolean {
  return isSameFilePath(left, right)
}

async function assertSessionOwnership(
  run: SecretaryRun,
  assignment: NonNullable<SecretaryRun['plan']>['assignments'][number],
  sessionId: string
): Promise<PtySessionSnapshot> {
  const session = ptyManager.getSessionSnapshot(sessionId)
  if (!session || session.kind !== assignment.kind || session.status === 'stopped' || session.status === 'error') {
    throw new Error(`The selected ${assignment.kind} CLI session is unavailable`)
  }
  if (session.projectId !== run.projectId) {
    throw new Error('The selected CLI session belongs to a different project')
  }
  if (assignment.panelId && assignment.panelId !== sessionId) {
    throw new Error('The approved assignment is bound to a different CLI panel')
  }
  const snapshot = loadSnapshot()
  const project = snapshot.projects.find((item) => item.id === run.projectId)
  const panel = snapshot.workspaces[run.projectId]?.panels.find((item) => item.id === sessionId)
  if (!project?.folderPath || !panel || panel.type !== assignment.kind) {
    throw new Error('The selected CLI session is no longer registered to this project workspace')
  }
  if (panel.accountId !== session.accountId) {
    throw new Error('The selected CLI session is using a different account than its project panel')
  }
  if (
    panel.panelRole !== 'secretary' ||
    panel.workspaceIsolation !== 'isolated' ||
    panel.cwdOverride ||
    !panel.worktreePath ||
    !session.worktreePath ||
    !samePath(session.cwd, panel.worktreePath) ||
    !samePath(session.worktreePath, panel.worktreePath) ||
    samePath(session.cwd, project.folderPath)
  ) {
    throw new Error('Secretary tasks require a dedicated isolated worktree; the project folder or a shared CLI session cannot be used')
  }
  if (!(await isRegisteredAgentWorktree({
    projectRoot: project.folderPath,
    kind: assignment.kind,
    panelId: sessionId,
    worktreePath: session.cwd
  }))) {
    throw new Error('The selected CLI session is not in its registered Git worktree')
  }
  return session
}

function assertDistinctWorktrees(cwds: string[]): void {
  if (cwds.some((cwd, index) => cwds.slice(0, index).some((other) =>
    samePath(canonicalRepoRoot(cwd), canonicalRepoRoot(other))
  ))) {
    throw new Error('Each Secretary assignment requires a different isolated worktree')
  }
}

/**
 * Verifies project/session bindings while the run is still awaiting approval.
 * This makes panel launch and session ownership an explicit handshake instead
 * of relying only on the later terminal write.
 */
export async function prepareSecretaryRun(payload: unknown): Promise<SecretaryRunPreparationResult> {
  const request = parseDispatchRequest(payload)
  const store = getSecretaryStore()
  if (!store) throw new Error('Secretary storage is not ready yet')
  const run = store.getRun(request.runId)
  if (!run || run.status !== 'awaiting-approval' || !run.plan) {
    throw new Error('This plan is no longer awaiting approval')
  }
  if (run.projectId !== request.projectId) {
    throw new Error('This plan belongs to a different project')
  }
  if (request.assignments.length !== run.plan.assignments.length) {
    throw new Error('Every assignment must be prepared before approval')
  }
  const bindings = new Map<string, string>()
  for (const binding of request.assignments) {
    if (bindings.has(binding.assignmentId)) throw new Error('An assignment was prepared more than once')
    bindings.set(binding.assignmentId, binding.sessionId)
  }
  const preparedCwds: string[] = []
  for (const assignment of run.plan.assignments) {
    const sessionId = bindings.get(assignment.id)
    if (!sessionId) throw new Error('An approved assignment has no prepared CLI session')
    preparedCwds.push((await assertSessionOwnership(run, assignment, sessionId)).cwd)
  }
  if (new Set(request.assignments.map((binding) => binding.sessionId)).size !== request.assignments.length) {
    throw new Error('Each assignment must use a different CLI session')
  }
  assertDistinctWorktrees(preparedCwds)
  return {
    runId: run.id,
    projectId: run.projectId,
    preparedAssignmentIds: run.plan.assignments.map((assignment) => assignment.id)
  }
}

/**
 * Performs the irreversible terminal write only after a persisted approval.
 * The renderer can choose a visible panel, but not alter the stored prompt.
 */
export async function dispatchSecretaryRun(payload: unknown): Promise<SecretaryRunDispatchResult> {
  const request = parseDispatchRequest(payload)
  const store = getSecretaryStore()
  if (!store) throw new Error('Secretary storage is not ready yet')
  const run = store.getRun(request.runId)
  if (!run || run.status !== 'approved' || !run.plan) {
    throw new Error('This plan is no longer approved for dispatch')
  }
  if (run.projectId !== request.projectId) {
    throw new Error('This approved plan belongs to a different project')
  }
  if (request.assignments.length !== run.plan.assignments.length) {
    throw new Error('Every approved assignment must be bound to one CLI session')
  }
  const bindings = new Map<string, string>()
  for (const binding of request.assignments) {
    if (bindings.has(binding.assignmentId)) throw new Error('An assignment was bound more than once')
    bindings.set(binding.assignmentId, binding.sessionId)
  }
  const steps: Array<{
    assignment: NonNullable<SecretaryRun['plan']>['assignments'][number]
    sessionId: string
    cwd: string
    gitStart: Awaited<ReturnType<typeof snapshotAgentGit>> | null
  }> = []
  for (const assignment of run.plan.assignments) {
    const sessionId = bindings.get(assignment.id)
    if (!sessionId) throw new Error('An approved assignment has no CLI session')
    const session = await assertSessionOwnership(run, assignment, sessionId)
    // Capture each step immediately before it is dispatched. Pending steps
    // must not treat earlier assignments' edits as their own baseline.
    steps.push({ assignment, sessionId, cwd: session.cwd, gitStart: null })
  }
  if (new Set(steps.map((step) => step.sessionId)).size !== steps.length) {
    throw new Error('Each approved assignment must use a different CLI session')
  }
  assertDistinctWorktrees(steps.map((step) => step.cwd))

  reserveSecretaryRunLock(run, steps.map((step) => step.sessionId))
  const running = store.updateRun(run.id, {
    status: 'running',
    sessionBindings: steps.map((step) => ({
      assignmentId: step.assignment.id,
      sessionId: step.sessionId,
      accountId: ptyManager.getSessionSnapshot(step.sessionId)?.accountId ?? null
    }))
  })
  if (!running) releaseSecretaryRunLock(run.id)
  if (!running) throw new Error('Could not start the approved run')
  const dispatchedAssignmentIds: string[] = []
  const dispatchedSessionIds: string[] = []
  let collectorStarted = false
  try {
    // Recovery bindings must survive a crash before the first terminal write.
    flushPersistenceToDisk()
    // Start every dependency-root task now. The collector releases dependent
    // tasks only after all of their prerequisites report a result.
    const ready = steps.filter((step) => (step.assignment.dependsOn ?? []).length === 0)
    if (ready.length === 0) throw new Error('An approved plan has no dispatchable dependency root')
    for (const step of ready) step.gitStart = await snapshotAgentGit(step.cwd)
    const updated = store.getRun(run.id)
    if (!updated) throw new Error('Could not load the running Secretary task')
    // Observe all root sessions before the first irreversible terminal write;
    // otherwise a fast CLI can finish before its output is being collected.
    trackSecretaryRun(updated, steps)
    collectorStarted = true
    for (const step of ready) {
      dispatchedSessionIds.push(step.sessionId)
      await ptyManager.writeForSecretary(
        step.sessionId,
        formatCliPaste(wrapSecretaryCliInstruction(step.assignment.instruction, {
          mode: step.assignment.mode,
          expectedResult: step.assignment.expectedResult
        }))
      )
      await waitForPasteCommit()
      await ptyManager.writeForSecretary(step.sessionId, '\r')
      dispatchedAssignmentIds.push(step.assignment.id)
    }
  } catch (cause) {
    if (collectorStarted) {
      cancelTrackedSecretaryRun(run.id)
    } else {
      releaseSecretaryRunLock(run.id)
    }
    void Promise.all(dispatchedSessionIds.map((sessionId) => ptyManager.writeForSecretary(sessionId, '\u0003').catch(() => undefined)))
    const message = cause instanceof Error ? cause.message : 'Could not send the approved prompt to the CLI'
    store.updateRun(run.id, { status: 'failed', errorCode: 'CLI_DISPATCH_FAILED', errorMessage: message })
    store.appendMessage({ threadId: run.threadId, runId: run.id, role: 'assistant', type: 'error', content: message })
    throw new Error(message)
  }
  const updated = store.getRun(run.id)
  if (!updated) throw new Error('Could not load the dispatched run')
  store.appendMessage({
    threadId: updated.threadId,
    runId: updated.id,
    role: 'assistant',
    type: 'approval',
    content: `Approved plan started with ${dispatchedAssignmentIds.length} dependency-root CLI session(s); dependent assignments will be released after prerequisite results.`
  })
  return { run: updated, dispatchedAssignmentIds }
}
