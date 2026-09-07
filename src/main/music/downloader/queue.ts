import { randomUUID } from 'crypto'
import type { DownloadJob, DownloadRequest, DownloadStatus, MediaAnalysis } from '@shared/contracts/downloads'
import { applyJobStatus, recoverInterruptedJob } from './job-state'
import type { DownloadJobRepository } from './job-store'
import type { EngineProgress } from './engine'

export interface QueueRunner {
  analyze(url: string, signal: AbortSignal): Promise<MediaAnalysis>
  download(
    job: DownloadJob,
    onProgress: (progress: EngineProgress) => void,
    signal: AbortSignal
  ): Promise<{ outputPath: string }>
  importCompleted?(job: DownloadJob, outputPath: string): Promise<string | undefined>
  cleanup?(outputPath: string | undefined): Promise<void>
}

export interface DownloadQueueOptions {
  store: DownloadJobRepository
  runner: QueueRunner
  getConcurrency: () => number
  now?: () => number
  onUpdate?: (job: DownloadJob) => void
}

export class DownloadQueue {
  private readonly active = new Map<string, AbortController>()
  private pumping = false

  constructor(private readonly options: DownloadQueueOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private persist(job: DownloadJob): DownloadJob {
    this.options.store.upsert(job)
    this.options.onUpdate?.(job)
    return job
  }

  recover(): DownloadJob[] {
    const recovered: DownloadJob[] = []
    for (const job of this.options.store.list()) {
      const next = recoverInterruptedJob(job, this.now())
      if (next !== job) {
        this.persist(next)
        recovered.push(next)
      }
    }
    return recovered
  }

  list(): DownloadJob[] {
    return this.options.store.list()
  }

  enqueue(request: DownloadRequest, extras: {
    destination: string
    title?: string
    creator?: string
    sourceType?: string
    quality?: string
  }): DownloadJob {
    const now = this.now()
    const job: DownloadJob = {
      id: randomUUID(),
      sourceUrl: request.sourceUrl,
      ...(extras.sourceType ? { sourceType: extras.sourceType } : {}),
      ...(extras.title ? { title: extras.title } : {}),
      ...(extras.creator ? { creator: extras.creator } : {}),
      mode: request.mode,
      format: request.outputExt,
      ...(extras.quality ? { quality: extras.quality } : {}),
      status: 'pending',
      destination: extras.destination,
      importToLibrary: request.importToLibrary,
      ...(request.playlistId ? { playlistId: request.playlistId } : {}),
      formatId: request.formatId,
      outputExt: request.outputExt,
      isConversion: request.isConversion,
      createdAt: now,
      updatedAt: now
    }
    this.persist(job)
    void this.pump()
    return job
  }

  async cancel(id: string): Promise<boolean> {
    const job = this.options.store.get(id)
    if (!job) return false
    if (job.status === 'completed') return false
    const controller = this.active.get(id)
    if (controller) {
      controller.abort()
      return true
    }
    if (job.status === 'pending') {
      this.persist(applyJobStatus(job, 'cancelled', this.now()))
      if (job.outputPath) await this.options.runner.cleanup?.(job.outputPath)
      return true
    }
    return false
  }

  retry(id: string): DownloadJob | null {
    const job = this.options.store.get(id)
    if (!job) return null
    if (job.status !== 'failed' && job.status !== 'cancelled') return null
    const next = applyJobStatus(
      {
        ...job,
        error: undefined,
        progress: undefined,
        speedBytesPerSec: undefined,
        etaSec: undefined,
        outputPath: undefined,
        completedAt: undefined
      },
      'pending',
      this.now()
    )
    this.persist(next)
    void this.pump()
    return next
  }

  dispose(): void {
    for (const [id, controller] of this.active) {
      controller.abort()
      const job = this.options.store.get(id)
      if (job && (job.status === 'downloading' || job.status === 'processing' || job.status === 'analyzing')) {
        this.persist({
          ...job,
          status: 'failed',
          error: 'Interrupted when Bikorch closed. The file was not marked complete.',
          updatedAt: this.now(),
          completedAt: this.now()
        })
      }
    }
    this.active.clear()
  }

  async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      const concurrency = Math.min(2, Math.max(1, this.options.getConcurrency()))
      const pending = this.options.store.list().filter((job) => job.status === 'pending')
      const slots = Math.max(0, concurrency - this.active.size)
      for (const next of pending.slice(0, slots)) {
        void this.run(next)
      }
    } finally {
      this.pumping = false
    }
  }

  private async run(job: DownloadJob): Promise<void> {
    if (this.active.has(job.id)) return
    const controller = new AbortController()
    this.active.set(job.id, controller)
    let current = job

    try {
      if (!current.title) {
        current = this.persist(applyJobStatus(current, 'analyzing', this.now()))
        try {
          const analysis = await this.options.runner.analyze(current.sourceUrl, controller.signal)
          current = this.persist({
            ...current,
            ...(analysis.title ? { title: analysis.title } : {}),
            ...(analysis.creator ? { creator: analysis.creator } : {}),
            ...(analysis.sourceType ? { sourceType: analysis.sourceType } : {}),
            updatedAt: this.now()
          })
        } catch (error) {
          if (controller.signal.aborted) throw error
        }
      }

      current = this.persist(applyJobStatus(current, 'downloading', this.now()))
      const result = await this.options.runner.download(
        current,
        (progress) => {
          const latest = this.options.store.get(job.id)
          if (!latest || latest.status !== 'downloading') return
          this.persist({
            ...latest,
            progress: progress.percent,
            speedBytesPerSec: progress.speedBytesPerSec,
            etaSec: progress.etaSec,
            updatedAt: this.now()
          })
        },
        controller.signal
      )

      if (controller.signal.aborted) {
        await this.options.runner.cleanup?.(result.outputPath)
        current = this.persist({
          ...applyJobStatus({ ...current, outputPath: result.outputPath }, 'cancelled', this.now()),
          error: undefined
        })
        return
      }

      current = this.persist(
        applyJobStatus({ ...current, outputPath: result.outputPath, progress: 100 }, 'processing', this.now())
      )

      let trackId: string | undefined
      if (current.importToLibrary && current.mode === 'audio') {
        trackId = await this.options.runner.importCompleted?.(current, result.outputPath)
      }

      if (controller.signal.aborted) {
        await this.options.runner.cleanup?.(result.outputPath)
        this.persist(applyJobStatus({ ...current, trackId }, 'cancelled', this.now()))
        return
      }

      this.persist({
        ...applyJobStatus({ ...current, outputPath: result.outputPath, trackId, progress: 100 }, 'completed', this.now()),
        error: undefined
      })
    } catch (error) {
      const message =
        controller.signal.aborted
          ? undefined
          : error instanceof Error
            ? error.message
            : 'Download failed'
      const status: DownloadStatus = controller.signal.aborted ? 'cancelled' : 'failed'
      await this.options.runner.cleanup?.(current.outputPath)
      try {
        this.persist({
          ...applyJobStatus(current, status, this.now()),
          ...(message ? { error: message } : { error: undefined })
        })
      } catch {
        this.persist({
          ...current,
          status,
          error: message,
          updatedAt: this.now(),
          completedAt: this.now()
        })
      }
    } finally {
      this.active.delete(job.id)
      void this.pump()
    }
  }

  getActiveCount(): number {
    return this.active.size
  }
}
