import { AudioLines, Loader2, Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { formatTrackDuration, useMusicStore } from '@renderer/stores/music-store'
import { trackCoverUrl } from '@renderer/lib/track-artwork'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'

export function SidebarNowPlaying(): React.JSX.Element {
  const tracks = useMusicStore((state) => state.tracks)
  const currentTrackId = useMusicStore((state) => state.currentTrackId)
  const status = useMusicStore((state) => state.status)
  const positionMs = useMusicStore((state) => state.positionMs)
  const durationMs = useMusicStore((state) => state.durationMs)
  const togglePlay = useMusicStore((state) => state.togglePlay)
  const next = useMusicStore((state) => state.next)
  const previous = useMusicStore((state) => state.previous)
  const seek = useMusicStore((state) => state.seek)
  const error = useMusicStore((state) => state.error)
  const openPlayerPanel = useWorkspaceStore((state) => state.openPlayerPanel)
  const current = tracks.find((track) => track.id === currentTrackId) ?? null
  const cover = trackCoverUrl(current)
  const total = durationMs || current?.durationMs || 0

  return (
    <div className="music-sidebar-player">
      <button
        type="button"
        className="music-sidebar-art"
        onClick={() => openPlayerPanel()}
        aria-label="Open Player"
      >
        {cover ? <img src={cover} alt="" /> : <Music2 className="h-6 w-6" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium text-text-primary">
              {current?.title ?? 'Nothing playing'}
            </p>
            <p className="truncate text-[10px] text-text-muted">
              {error ?? current?.artist ?? 'Choose a track'}
            </p>
          </div>
          <button type="button" className="music-sidebar-open" onClick={() => openPlayerPanel()}>
            <AudioLines className="h-3 w-3" />
            Player
          </button>
        </div>
        <div className="music-sidebar-controls">
          <button type="button" className="music-icon-btn" onClick={() => void previous()} aria-label="Previous">
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="music-sidebar-play"
            onClick={() => void togglePlay()}
            aria-label={status === 'playing' ? 'Pause' : 'Play'}
          >
            {status === 'loading' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : status === 'playing' ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>
          <button type="button" className="music-icon-btn" onClick={() => void next()} aria-label="Next">
            <SkipForward className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="music-sidebar-seek">
          <span>{formatTrackDuration(positionMs)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(total, 1)}
            value={Math.min(positionMs, total)}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Seek"
          />
          <span>{formatTrackDuration(total)}</span>
        </div>
      </div>
    </div>
  )
}
