import type { SecretaryRun } from '@shared/contracts/secretary'
import { isLiveSecretaryRun } from './sessions'

/** Bounded, factual run context for a Manager conversation turn. */
export function managerRunContext(runs: SecretaryRun[]): unknown[] {
  const work = runs.filter((run) => run.plan || run.evidence || run.status === 'interrupted')
  const live = work.filter((run) => isLiveSecretaryRun(run.status))
  const recent = work.filter((run) => !isLiveSecretaryRun(run.status))
  return [...live.slice(0, 4), ...recent.slice(0, 3)].slice(0, 6).map((run) => ({
    runId: run.id,
    status: run.status,
    requestedAt: run.createdAt,
    updatedAt: run.updatedAt,
    request: run.requestText.slice(0, 1_000),
    plan: run.plan ? {
      overview: run.plan.overview,
      assignments: run.plan.assignments.map((assignment) => ({
        id: assignment.id,
        kind: assignment.kind,
        mode: assignment.mode,
        title: assignment.title,
        expectedResult: assignment.expectedResult
      }))
    } : null,
    sessions: run.sessionBindings.map((binding) => ({
      assignmentId: binding.assignmentId,
      sessionId: binding.sessionId
    })),
    managerReport: run.status === 'completed' ? run.reply?.slice(0, 2_500) : null,
    error: run.errorMessage,
    evidence: run.evidence ? {
      verificationLevel: run.evidence.verificationLevel,
      changedFiles: run.evidence.changedFiles.slice(0, 30),
      unverifiedReportedFiles: run.evidence.unverifiedReportedFiles.slice(0, 20),
      assignments: run.evidence.assignments.map((assignment) => ({
        assignmentId: assignment.assignmentId,
        title: assignment.title,
        outcome: assignment.outcome,
        completionEvidence: assignment.completionEvidence,
        changedFiles: assignment.changedFiles.slice(0, 20),
        preexistingChangedFiles: assignment.preexistingChangedFiles.slice(0, 20),
        patchCheckExitCode: assignment.patchCheckExitCode
      }))
    } : null
  }))
}
