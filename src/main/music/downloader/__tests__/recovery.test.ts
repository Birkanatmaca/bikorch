import { describe, expect, it } from 'vitest'
import type { DownloadJob } from '@shared/contracts/downloads'
import { recoverInterruptedJob } from '../job-state'
import { MemoryDownloadJobRepository } from '../job-store'

function job(status: DownloadJob['status']): DownloadJob {
  return {
    id: `job-${status}`,
    sourceUrl: 'https://example.com/a',
    mode: 'audio',
    format: 'mp3',
    status,
    destination: '/tmp/bikorch',
    importToLibrary: true,
    formatId: '140',
    outputExt: 'mp3',
    isConversion: true,
    createdAt: 10,
    updatedAt: 20
  }
}

describe('persistence recovery', () => {
  it('does not mark completed jobs as finished again and fails in-flight work', () => {
    const store = new MemoryDownloadJobRepository()
    for (const status of ['pending', 'downloading', 'processing', 'completed', 'failed'] as const) {
      store.upsert(job(status))
    }

    const recovered = store.list().map((item) => recoverInterruptedJob(item, 50))
    expect(recovered.find((item) => item.id === 'job-pending')?.status).toBe('pending')
    expect(recovered.find((item) => item.id === 'job-completed')?.status).toBe('completed')
    expect(recovered.find((item) => item.id === 'job-failed')?.status).toBe('failed')
    expect(recovered.find((item) => item.id === 'job-downloading')?.status).toBe('failed')
    expect(recovered.find((item) => item.id === 'job-processing')?.status).toBe('failed')
    expect(recovered.find((item) => item.id === 'job-downloading')?.error).toMatch(/not marked complete/)
  })
})
