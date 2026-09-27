import type {
  SecretaryRun,
  SecretarySessionSummary,
  SecretarySessionWork,
  SecretarySessionWorkStatus,
  SecretaryThread
} from '@shared/contracts/secretary'

const LIVE_RUN_STATUSES = new Set(['planning', 'awaiting-approval', 'approved', 'running', 'needs-user'])

export function isLiveSecretaryRun(status: string): boolean {
  return LIVE_RUN_STATUSES.has(status)
}

function workStatus(status: SecretaryRun['status']): SecretarySessionWorkStatus {
  if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'rejected' || status === 'interrupted') {
    return status
  }
  return 'active'
}

function workLabel(run: SecretaryRun): string {
  const title = run.plan?.assignments.find((assignment) => assignment.title.trim())?.title
    || run.plan?.overview
    || run.requestText
  return title.replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function sessionWork(runs: SecretaryRun[]): SecretarySessionWork[] {
  return runs.flatMap((run) => {
    const label = workLabel(run)
    return label ? [{ label, status: workStatus(run.status) }] : []
  }).slice(0, 3)
}

export function buildSessionSummaries(
  threads: SecretaryThread[],
  runs: SecretaryRun[],
  messageCounts: Record<string, number>
): SecretarySessionSummary[] {
  const runsByThread = new Map<string, SecretaryRun[]>()
  for (const run of runs) {
    const current = runsByThread.get(run.threadId) ?? []
    current.push(run)
    runsByThread.set(run.threadId, current)
  }
  return threads.map((thread) => ({
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: messageCounts[thread.id] ?? 0,
    work: sessionWork(runsByThread.get(thread.id) ?? [])
  }))
}
