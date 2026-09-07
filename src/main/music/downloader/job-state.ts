import type { DownloadJob, DownloadStatus } from '@shared/contracts/downloads'
import { canTransitionStatus } from './args'

export function applyJobStatus(job: DownloadJob, next: DownloadStatus, now: number): DownloadJob {
  if (job.status === next) return { ...job, updatedAt: now }
  if (!canTransitionStatus(job.status, next)) {
    throw new Error(`Cannot move download from ${job.status} to ${next}`)
  }
  return {
    ...job,
    status: next,
    updatedAt: now,
    ...(next === 'completed' || next === 'failed' || next === 'cancelled'
      ? { completedAt: now }
      : { completedAt: undefined })
  }
}

export function recoverInterruptedJob(job: DownloadJob, now: number): DownloadJob {
  if (job.status === 'pending') return job
  if (job.status === 'analyzing' || job.status === 'downloading' || job.status === 'processing') {
    return {
      ...job,
      status: 'failed',
      error: 'Interrupted when Bikorch closed. The file was not marked complete.',
      progress: job.status === 'processing' ? job.progress : undefined,
      speedBytesPerSec: undefined,
      etaSec: undefined,
      updatedAt: now,
      completedAt: now
    }
  }
  return job
}
