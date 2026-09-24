import type { SecretaryRunEvidence, SecretarySessionBinding } from '@shared/contracts/secretary'
import type { SecretaryCliResult } from './service'

function unique(values: string[], limit: number): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit)
}

/** Git is independently observed, but neither Git activity nor a CLI result proves the task passed. */
export function buildSecretaryRunEvidence(
  results: SecretaryCliResult[],
  bindings: SecretarySessionBinding[],
  capturedAt = Date.now()
): SecretaryRunEvidence {
  const sessionByAssignment = new Map(bindings.map((binding) => [binding.assignmentId, binding]))
  const assignments = results.slice(0, 8).map((result) => ({
    assignmentId: result.assignmentId,
    sessionId: sessionByAssignment.get(result.assignmentId)?.sessionId ?? '',
    accountId: sessionByAssignment.get(result.assignmentId)?.accountId ?? null,
    kind: result.kind,
    title: result.title,
    outcome: result.outcome,
    completionEvidence: result.completionEvidence,
    changedFiles: unique(result.git.changedFiles, 80),
    preexistingChangedFiles: unique(result.git.preexistingChangedFiles, 80),
    commits: result.git.commits.slice(0, 20),
    patchCheckExitCode: result.git.patchCheckExitCode
  }))
  const changedFiles = unique(assignments.flatMap((assignment) => assignment.changedFiles), 120)
  const unverifiedReportedFiles = unique(results.flatMap((result) => result.git.unverifiedReportedFiles), 80)
  const gitObserved = assignments.some((assignment) => assignment.changedFiles.length > 0 || assignment.commits.length > 0)
  return {
    capturedAt,
    verificationLevel: gitObserved
      ? 'git-observed'
      : assignments.length > 0 && assignments.every((assignment) => assignment.completionEvidence === 'cli-reported')
        ? 'cli-reported'
        : 'inferred',
    changedFiles,
    unverifiedReportedFiles,
    assignments
  }
}
