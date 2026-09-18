import { formatCliPaste } from '@shared/cli-prompt'
import { wrapSecretaryCliInstruction } from '@shared/secretary-result-protocol'
import type {
  SecretaryRun,
  SecretaryRunDispatchRequest,
  SecretaryRunDispatchResult
} from '@shared/contracts/secretary'
import { ptyManager } from '../cli/pty-manager'
import { getSecretaryStore } from './store'
import { trackSecretaryRun } from './result-collector'

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
  const steps = run.plan.assignments.map((assignment) => {
    const sessionId = bindings.get(assignment.id)
    if (!sessionId) throw new Error('An approved assignment has no CLI session')
    const session = ptyManager.getSessionSnapshot(sessionId)
    if (!session || session.kind !== assignment.kind || session.status === 'stopped' || session.status === 'error') {
      throw new Error(`The selected ${assignment.kind} CLI session is unavailable`)
    }
    return { assignment, sessionId }
  })
  if (new Set(steps.map((step) => step.sessionId)).size !== steps.length) {
    throw new Error('Each approved assignment must use a different CLI session')
  }

  const running = store.updateRun(run.id, { status: 'running' })
  if (!running) throw new Error('Could not start the approved run')
  const dispatchedAssignmentIds: string[] = []
  try {
    for (const step of steps) {
      await ptyManager.writeForSecretary(
        step.sessionId,
        formatCliPaste(wrapSecretaryCliInstruction(step.assignment.instruction))
      )
      await waitForPasteCommit()
      await ptyManager.writeForSecretary(step.sessionId, '\r')
      dispatchedAssignmentIds.push(step.assignment.id)
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Could not send the approved prompt to the CLI'
    store.updateRun(run.id, { status: 'failed', errorCode: 'CLI_DISPATCH_FAILED', errorMessage: message })
    store.appendMessage({ threadId: run.threadId, runId: run.id, role: 'assistant', type: 'error', content: message })
    throw new Error(message)
  }
  const updated = store.getRun(run.id)
  if (!updated) throw new Error('Could not load the dispatched run')
  trackSecretaryRun(updated, steps)
  store.appendMessage({
    threadId: updated.threadId,
    runId: updated.id,
    role: 'assistant',
    type: 'approval',
    content: `Approved plan dispatched to ${dispatchedAssignmentIds.length} CLI session(s).`
  })
  return { run: updated, dispatchedAssignmentIds }
}
