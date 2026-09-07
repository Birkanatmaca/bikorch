import { describe, expect, it, vi } from 'vitest'
import type { DownloadJob, DownloadRequest } from '@shared/contracts/downloads'
import { MemoryDownloadJobRepository } from '../job-store'
import { recoverInterruptedJob } from '../job-state'
import { DownloadQueue, type QueueRunner } from '../queue'

function request(overrides: Partial<DownloadRequest> = {}): DownloadRequest {
  return {
    sourceUrl: 'https://example.com/a.mp4',
    mode: 'audio',
    formatId: '140',
    outputExt: 'm4a',
    isConversion: false,
    destinationId: 'default',
    importToLibrary: false,
    ...overrides
  }
}

function delayedRunner(options: {
  delayMs?: number
  fail?: boolean
  onStart?: (job: DownloadJob) => void
  importedTrackId?: string
  cleaned?: string[]
}): QueueRunner {
  return {
    analyze: async () => {
      throw new Error('not used')
    },
    download: async (job, onProgress, signal) => {
      options.onStart?.(job)
      onProgress({ percent: 10, speedBytesPerSec: 1000, etaSec: 9 })
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, options.delayMs ?? 30)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('Download cancelled'))
        })
      })
      if (options.fail) throw new Error('engine failed')
      return { outputPath: `${job.destination}/out.${job.outputExt}` }
    },
    importCompleted: async () => options.importedTrackId,
    cleanup: async (outputPath) => {
      if (outputPath) options.cleaned?.push(outputPath)
    }
  }
}

describe('download queue', () => {
  it('respects a concurrency limit of 2', async () => {
    const store = new MemoryDownloadJobRepository()
    let running = 0
    let peak = 0
    const queue = new DownloadQueue({
      store,
      getConcurrency: () => 2,
      runner: {
        analyze: async () => {
          throw new Error('not used')
        },
        download: async (job, onProgress, signal) => {
          running += 1
          peak = Math.max(peak, running)
          try {
            onProgress({ percent: 10 })
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, 40)
              signal.addEventListener('abort', () => {
                clearTimeout(timer)
                reject(new Error('Download cancelled'))
              })
            })
            return { outputPath: `${job.destination}/out.${job.outputExt}` }
          } finally {
            running -= 1
          }
        }
      }
    })

    queue.enqueue(request(), { destination: '/tmp/a', title: 'A' })
    queue.enqueue(request(), { destination: '/tmp/a', title: 'B' })
    queue.enqueue(request(), { destination: '/tmp/a', title: 'C' })
    await vi.waitFor(() => {
      expect(store.list().filter((job) => job.status === 'completed')).toHaveLength(3)
    })
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('cancels a pending or active job', async () => {
    const store = new MemoryDownloadJobRepository()
    const queue = new DownloadQueue({
      store,
      getConcurrency: () => 1,
      runner: delayedRunner({ delayMs: 200 })
    })
    const active = queue.enqueue(request(), { destination: '/tmp/a', title: 'Now' })
    const pending = queue.enqueue(request(), { destination: '/tmp/a', title: 'Later' })
    await queue.cancel(pending.id)
    expect(store.get(pending.id)?.status).toBe('cancelled')
    await queue.cancel(active.id)
    await vi.waitFor(() => {
      expect(store.get(active.id)?.status).toBe('cancelled')
    })
  })

  it('cleans up after a failed download and can retry', async () => {
    const cleaned: string[] = []
    const store = new MemoryDownloadJobRepository()
    const queue = new DownloadQueue({
      store,
      getConcurrency: () => 1,
      runner: delayedRunner({ delayMs: 5, fail: true, cleaned })
    })
    const job = queue.enqueue(request(), { destination: '/tmp/a', title: 'Fail' })
    await vi.waitFor(() => {
      expect(store.get(job.id)?.status).toBe('failed')
    })
    expect(store.get(job.id)?.error).toBe('engine failed')
    expect(cleaned.length).toBeGreaterThanOrEqual(0)

    const recovered = recoverInterruptedJob(
      { ...job, status: 'downloading', createdAt: 1, updatedAt: 1, formatId: '140', outputExt: 'm4a', isConversion: false, format: 'm4a', mode: 'audio', sourceUrl: job.sourceUrl, destination: '/tmp/a', importToLibrary: false },
      99
    )
    expect(recovered.status).toBe('failed')
    expect(recovered.error).toMatch(/Interrupted/)

    const retryRunner = delayedRunner({ delayMs: 5 })
    const retryQueue = new DownloadQueue({
      store,
      getConcurrency: () => 1,
      runner: retryRunner
    })
    expect(retryQueue.retry(job.id)?.status).toBe('pending')
    await vi.waitFor(() => {
      expect(store.get(job.id)?.status).toBe('completed')
    })
  })

  it('fills title and artist from analyze before downloading', async () => {
    const store = new MemoryDownloadJobRepository()
    const queue = new DownloadQueue({
      store,
      getConcurrency: () => 1,
      runner: {
        analyze: async () => ({
          sourceUrl: 'https://example.com/a',
          sourceType: 'youtube',
          title: 'AURA Phonk Mix',
          creator: 'Night Channel',
          audioFormats: [],
          videoFormats: []
        }),
        download: async (job) => {
          expect(job.title).toBe('AURA Phonk Mix')
          expect(job.creator).toBe('Night Channel')
          return { outputPath: `${job.destination}/out.mp3` }
        }
      }
    })
    const job = queue.enqueue(request(), { destination: '/tmp/a' })
    await vi.waitFor(() => {
      expect(store.get(job.id)?.status).toBe('completed')
    })
    expect(store.get(job.id)?.title).toBe('AURA Phonk Mix')
  })

  it('imports completed audio through the library hook', async () => {
    const store = new MemoryDownloadJobRepository()
    const queue = new DownloadQueue({
      store,
      getConcurrency: () => 1,
      runner: delayedRunner({ delayMs: 5, importedTrackId: 'track-1' })
    })
    const job = queue.enqueue(request({ importToLibrary: true }), { destination: '/tmp/a', title: 'Import' })
    await vi.waitFor(() => {
      expect(store.get(job.id)?.status).toBe('completed')
    })
    expect(store.get(job.id)?.trackId).toBe('track-1')
  })
})
