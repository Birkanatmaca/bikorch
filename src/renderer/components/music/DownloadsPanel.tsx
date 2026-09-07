import { useEffect, useState } from 'react'
import { Play, RefreshCw, Square, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/Button'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { useDownloadStore } from '@renderer/stores/download-store'
import { useMusicStore } from '@renderer/stores/music-store'
import type { DownloadAudioQuality, DownloadJob, DownloadStatus } from '@shared/contracts/downloads'

function statusLabel(status: DownloadStatus): string {
  if (status === 'pending' || status === 'analyzing' || status === 'downloading') return 'Downloading'
  if (status === 'processing') return 'Saving'
  if (status === 'completed') return 'Ready'
  if (status === 'failed') return 'Failed'
  return 'Cancelled'
}

export function DownloadsPanel(): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DownloadJob | null>(null)
  const [deleting, setDeleting] = useState(false)
  const playTrack = useMusicStore((state) => state.playTrack)
  const refreshLibrary = useMusicStore((state) => state.refreshLibrary)
  const bootstrap = useDownloadStore((state) => state.bootstrap)
  const url = useDownloadStore((state) => state.url)
  const setUrl = useDownloadStore((state) => state.setUrl)
  const downloadFromUrl = useDownloadStore((state) => state.downloadFromUrl)
  const analyzing = useDownloadStore((state) => state.analyzing)
  const starting = useDownloadStore((state) => state.starting)
  const jobs = useDownloadStore((state) => state.jobs)
  const settings = useDownloadStore((state) => state.settings)
  const updateSettings = useDownloadStore((state) => state.updateSettings)
  const cancel = useDownloadStore((state) => state.cancel)
  const retry = useDownloadStore((state) => state.retry)
  const deleteJob = useDownloadStore((state) => state.deleteJob)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const busy = analyzing || starting
  const audioJobs = jobs.filter((job) => job.mode === 'audio')

  const submit = async (): Promise<void> => {
    const link = url.trim()
    if (!link || busy) return
    setError(null)
    const result = await downloadFromUrl()
    setError(result)
    if (!result) {
      setUrl('')
      await refreshLibrary()
    }
  }

  const playJob = (job: DownloadJob): void => {
    if (job.trackId) void playTrack(job.trackId)
  }

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete || deleting) return
    setDeleting(true)
    const result = await deleteJob(pendingDelete.id)
    setDeleting(false)
    if (result) {
      setError(result)
      return
    }
    setPendingDelete(null)
    await refreshLibrary()
  }

  const setQuality = (quality: DownloadAudioQuality): void => {
    void updateSettings({ defaultAudioQuality: quality })
  }

  return (
    <div className="music-download-page">
      <div className="music-download-composer">
        <input
          className="music-download-input"
          value={url}
          placeholder="Paste a YouTube or audio link"
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setUrl(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
        <Button variant="primary" size="sm" disabled={!url.trim() || busy} onClick={() => void submit()}>
          {busy ? 'Starting…' : 'Download'}
        </Button>
      </div>
      {error && <p className="text-[10px] text-danger">{error}</p>}

      <section className="music-download-settings">
        <p className="music-download-kicker">Settings</p>
        <div className="music-download-setting-row">
          <span>Quality</span>
          <div className="music-download-seg" role="group" aria-label="Quality">
            <button
              type="button"
              className={(settings.defaultAudioQuality ?? 'high') === 'high' ? 'is-active' : undefined}
              onClick={() => setQuality('high')}
            >
              High
            </button>
            <button
              type="button"
              className={settings.defaultAudioQuality === 'standard' ? 'is-active' : undefined}
              onClick={() => setQuality('standard')}
            >
              Standard
            </button>
          </div>
        </div>
      </section>

      <section className="music-download-list">
        <p className="music-download-kicker">Downloaded</p>
        {audioJobs.length === 0 && <div className="profile-empty-state">Nothing downloaded yet.</div>}
        {audioJobs.map((job) => {
          const active =
            job.status === 'pending' ||
            job.status === 'analyzing' ||
            job.status === 'downloading' ||
            job.status === 'processing'
          return (
            <div key={job.id} className="music-download-job">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => playJob(job)}
                disabled={job.status !== 'completed'}
              >
                <p className="truncate text-[11px] font-medium text-text-primary">{job.title ?? job.sourceUrl}</p>
                <p className="truncate text-[9px] text-text-muted">
                  {statusLabel(job.status)}
                  {active && job.progress !== undefined ? ` · ${Math.round(job.progress)}%` : ''}
                  {job.error ? ` · ${job.error}` : ''}
                </p>
                {active && (
                  <div className="music-download-progress mt-1">
                    <span style={{ width: `${Math.min(100, job.progress ?? 0)}%` }} />
                  </div>
                )}
              </button>
              {active && (
                <button type="button" className="music-icon-btn" onClick={() => void cancel(job.id)} aria-label="Stop">
                  <Square className="h-3 w-3" />
                </button>
              )}
              {job.status === 'completed' && job.trackId && (
                <button type="button" className="music-icon-btn" onClick={() => playJob(job)} aria-label="Play">
                  <Play className="h-3 w-3" />
                </button>
              )}
              {(job.status === 'failed' || job.status === 'cancelled') && (
                <button type="button" className="music-icon-btn" onClick={() => void retry(job.id)} aria-label="Retry">
                  <RefreshCw className="h-3 w-3" />
                </button>
              )}
              {!active && (
                <button
                  type="button"
                  className="music-icon-btn"
                  onClick={() => setPendingDelete(job)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}
      </section>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this download?"
          message={`${pendingDelete.title ?? 'This file'} will be permanently removed from this computer. It will not go to the Recycle Bin. You can download it again later.`}
          confirmLabel="Delete"
          busy={deleting}
          onCancel={() => {
            if (!deleting) setPendingDelete(null)
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  )
}
