import type { SecretaryRun } from '@shared/contracts/secretary'

const projectOwners = new Map<string, string>()
const sessionOwners = new Map<string, string>()
const runProjects = new Map<string, string>()
const runSessions = new Map<string, string[]>()

/**
 * A project may have one active Secretary write run at a time. Session locks
 * also prevent two approved runs from pasting into the same terminal.
 */
export function reserveSecretaryRunLock(run: SecretaryRun, sessionIds: string[]): void {
  const projectOwner = projectOwners.get(run.projectId)
  if (projectOwner && projectOwner !== run.id) {
    throw new Error('Another Secretary run is already active for this project')
  }
  for (const sessionId of sessionIds) {
    const sessionOwner = sessionOwners.get(sessionId)
    if (sessionOwner && sessionOwner !== run.id) {
      throw new Error('A selected CLI session is already running another Secretary task')
    }
  }
  projectOwners.set(run.projectId, run.id)
  runProjects.set(run.id, run.projectId)
  const uniqueSessions = [...new Set(sessionIds)]
  runSessions.set(run.id, uniqueSessions)
  for (const sessionId of uniqueSessions) sessionOwners.set(sessionId, run.id)
}

export function releaseSecretaryRunLock(runId: string): void {
  const projectId = runProjects.get(runId)
  if (projectId && projectOwners.get(projectId) === runId) projectOwners.delete(projectId)
  runProjects.delete(runId)
  for (const sessionId of runSessions.get(runId) ?? []) {
    if (sessionOwners.get(sessionId) === runId) sessionOwners.delete(sessionId)
  }
  runSessions.delete(runId)
}

export function clearSecretaryRunLocks(): void {
  projectOwners.clear()
  sessionOwners.clear()
  runProjects.clear()
  runSessions.clear()
}
