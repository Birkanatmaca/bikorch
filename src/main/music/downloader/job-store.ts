import type { Database } from 'sql.js'
import type { DownloadJob, DownloadMode, DownloadStatus } from '@shared/contracts/downloads'
import { DOWNLOAD_SCHEMA_VERSION } from '@shared/contracts/downloads'
import { getPersistenceDatabase, schedulePersistToDisk } from '../../persistence/database'

type Row = Record<string, unknown>

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : undefined
}

function bool(value: unknown): boolean {
  return value === 1 || value === true
}

function rowToJob(row: Row): DownloadJob | null {
  const id = text(row['id'])
  const sourceUrl = text(row['source_url'])
  const mode = text(row['mode']) as DownloadMode | undefined
  const format = text(row['format'])
  const status = text(row['status']) as DownloadStatus | undefined
  const destination = text(row['destination'])
  const createdAt = integer(row['created_at'])
  const updatedAt = integer(row['updated_at'])
  const formatId = text(row['format_id']) ?? format
  const outputExt = text(row['output_ext']) ?? 'mp3'
  if (!id || !sourceUrl || !mode || !format || !status || !destination || createdAt === undefined || updatedAt === undefined) {
    return null
  }
  return {
    id,
    sourceUrl,
    ...(text(row['source_type']) ? { sourceType: text(row['source_type']) } : {}),
    ...(text(row['title']) ? { title: text(row['title']) } : {}),
    ...(text(row['creator']) ? { creator: text(row['creator']) } : {}),
    mode,
    format,
    ...(text(row['quality']) ? { quality: text(row['quality']) } : {}),
    status,
    destination,
    ...(text(row['output_path']) ? { outputPath: text(row['output_path']) } : {}),
    ...(integer(row['progress']) !== undefined ? { progress: Number(row['progress']) } : {}),
    ...(integer(row['speed_bps']) !== undefined ? { speedBytesPerSec: integer(row['speed_bps']) } : {}),
    ...(integer(row['eta_sec']) !== undefined ? { etaSec: integer(row['eta_sec']) } : {}),
    ...(text(row['error']) ? { error: text(row['error']) } : {}),
    ...(text(row['track_id']) ? { trackId: text(row['track_id']) } : {}),
    importToLibrary: bool(row['import_to_library']),
    ...(text(row['playlist_id']) ? { playlistId: text(row['playlist_id']) } : {}),
    formatId: formatId ?? format,
    outputExt,
    isConversion: bool(row['is_conversion']),
    createdAt,
    updatedAt,
    ...(integer(row['completed_at']) !== undefined ? { completedAt: integer(row['completed_at']) } : {})
  }
}

export function initDownloadSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS music_download_jobs (
      id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      source_type TEXT,
      title TEXT,
      creator TEXT,
      mode TEXT NOT NULL,
      format TEXT NOT NULL,
      quality TEXT,
      status TEXT NOT NULL,
      destination TEXT NOT NULL,
      output_path TEXT,
      progress REAL,
      speed_bps INTEGER,
      eta_sec INTEGER,
      error TEXT,
      track_id TEXT,
      import_to_library INTEGER NOT NULL DEFAULT 0,
      playlist_id TEXT,
      format_id TEXT,
      output_ext TEXT,
      is_conversion INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `)
  db.run('CREATE INDEX IF NOT EXISTS music_download_jobs_status ON music_download_jobs (status);')
  db.run('CREATE INDEX IF NOT EXISTS music_download_jobs_updated ON music_download_jobs (updated_at);')
  db.run('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', [
    'music_download_schema_version',
    String(DOWNLOAD_SCHEMA_VERSION)
  ])
}

export interface DownloadJobRepository {
  list(): DownloadJob[]
  get(id: string): DownloadJob | null
  upsert(job: DownloadJob): void
  remove(id: string): void
  clearTerminal(): number
}

export class SqlDownloadJobRepository implements DownloadJobRepository {
  constructor(private readonly db: Database) {}

  list(): DownloadJob[] {
    const result = this.db.exec('SELECT * FROM music_download_jobs ORDER BY created_at DESC')
    if (result.length === 0) return []
    const columns = result[0].columns
    return result[0].values
      .map((values) => {
        const row: Row = {}
        columns.forEach((column, index) => {
          row[column] = values[index]
        })
        return rowToJob(row)
      })
      .filter((job): job is DownloadJob => Boolean(job))
  }

  get(id: string): DownloadJob | null {
    const stmt = this.db.prepare('SELECT * FROM music_download_jobs WHERE id = ?')
    stmt.bind([id])
    if (!stmt.step()) {
      stmt.free()
      return null
    }
    const job = rowToJob(stmt.getAsObject() as Row)
    stmt.free()
    return job
  }

  upsert(job: DownloadJob): void {
    this.db.run(
      `INSERT OR REPLACE INTO music_download_jobs (
        id, source_url, source_type, title, creator, mode, format, quality, status, destination,
        output_path, progress, speed_bps, eta_sec, error, track_id, import_to_library, playlist_id,
        format_id, output_ext, is_conversion, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.id,
        job.sourceUrl,
        job.sourceType ?? null,
        job.title ?? null,
        job.creator ?? null,
        job.mode,
        job.format,
        job.quality ?? null,
        job.status,
        job.destination,
        job.outputPath ?? null,
        job.progress ?? null,
        job.speedBytesPerSec ?? null,
        job.etaSec ?? null,
        job.error ?? null,
        job.trackId ?? null,
        job.importToLibrary ? 1 : 0,
        job.playlistId ?? null,
        job.formatId,
        job.outputExt,
        job.isConversion ? 1 : 0,
        job.createdAt,
        job.updatedAt,
        job.completedAt ?? null
      ]
    )
    schedulePersistToDisk()
  }

  remove(id: string): void {
    this.db.run('DELETE FROM music_download_jobs WHERE id = ?', [id])
    schedulePersistToDisk()
  }

  clearTerminal(): number {
    const before = this.db.exec(
      "SELECT COUNT(*) FROM music_download_jobs WHERE status IN ('completed', 'failed', 'cancelled')"
    )
    const count = Number(before[0]?.values[0]?.[0] ?? 0)
    this.db.run("DELETE FROM music_download_jobs WHERE status IN ('completed', 'failed', 'cancelled')")
    schedulePersistToDisk()
    return count
  }
}

export function getDownloadJobRepository(): DownloadJobRepository | null {
  const db = getPersistenceDatabase()
  if (!db) return null
  return new SqlDownloadJobRepository(db)
}

export class MemoryDownloadJobRepository implements DownloadJobRepository {
  private readonly jobs = new Map<string, DownloadJob>()

  list(): DownloadJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): DownloadJob | null {
    return this.jobs.get(id) ?? null
  }

  upsert(job: DownloadJob): void {
    this.jobs.set(job.id, { ...job })
  }

  remove(id: string): void {
    this.jobs.delete(id)
  }

  clearTerminal(): number {
    let removed = 0
    for (const [id, job] of this.jobs) {
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        this.jobs.delete(id)
        removed += 1
      }
    }
    return removed
  }
}
