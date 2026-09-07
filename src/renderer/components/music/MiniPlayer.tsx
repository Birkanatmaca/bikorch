import {
  ExternalLink,
  Loader2,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2
} from 'lucide-react'
import {
  formatTrackDuration,
  useMusicStore
} from '@renderer/stores/music-store'
import { cn } from '@renderer/lib/utils'

export function MiniPlayer(): React.JSX.Element {
  const tracks = useMusicStore((state) => state.tracks)
  const currentTrackId = useMusicStore((state) => state.currentTrackId)
  const status = useMusicStore((state) => state.status)
  const positionMs = useMusicStore((state) => state.positionMs)
  const durationMs = useMusicStore((state) => state.durationMs)
  const volume = useMusicStore((state) => state.volume)
  const shuffle = useMusicStore((state) => state.shuffle)
  const repeat = useMusicStore((state) => state.repeat)
  const error = useMusicStore((state) => state.error)
  const spotifyPlayback = useMusicStore((state) => state.spotifyPlayback)
  const togglePlay = useMusicStore((state) => state.togglePlay)
  const next = useMusicStore((state) => state.next)
  const previous = useMusicStore((state) => state.previous)
  const seek = useMusicStore((state) => state.seek)
  const setVolume = useMusicStore((state) => state.setVolume)
  const toggleShuffle = useMusicStore((state) => state.toggleShuffle)
  const cycleRepeat = useMusicStore((state) => state.cycleRepeat)
  const openExternal = useMusicStore((state) => state.openExternal)

  const current = tracks.find((track) => track.id === currentTrackId) ?? null
  const sourceLabel =
    current?.source === 'youtube'
      ? 'YouTube'
      : current?.source === 'spotify'
        ? spotifyPlayback?.deviceName
          ? `Spotify · ${spotifyPlayback.deviceName}`
          : 'Spotify Connect'
        : 'Local library'
  const progress = durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0
  const show = tracks.length > 0 || currentTrackId

  if (!show) return <></>

  return (
    <div className="music-mini-player border-t border-border/60 bg-surface/95 px-3 py-2 app-no-drag">
      <div className="flex items-center gap-3">
        <div className="music-artwork flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-elevated text-text-muted">
          <Music2 className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-text-primary">
            {current?.title ?? 'No track selected'}
          </div>
          <div className="truncate text-[10px] text-text-muted">
            {error ?? current?.artist ?? sourceLabel}
          </div>
          <div className="mt-1 flex items-center gap-2">
            {current?.sourceUrl && (current.source === 'youtube' || current.source === 'spotify') && (
              <button
                type="button"
                className="music-icon-btn shrink-0"
                aria-label="Open in browser"
                onClick={() => void openExternal(current.sourceUrl!)}
              >
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
            <span className="w-8 text-[10px] tabular-nums text-text-muted">
              {formatTrackDuration(positionMs)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(durationMs, 1)}
              value={positionMs}
              onChange={(event) => seek(Number(event.target.value))}
              className="music-progress flex-1"
              aria-label="Seek"
            />
            <span className="w-8 text-right text-[10px] tabular-nums text-text-muted">
              {formatTrackDuration(durationMs || current?.durationMs)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={cn('music-control-btn', shuffle && 'is-active')} onClick={toggleShuffle} aria-label="Shuffle">
            <Shuffle className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="music-control-btn" onClick={() => void previous()} aria-label="Previous">
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="music-control-btn music-control-btn-primary"
            onClick={() => void togglePlay()}
            aria-label={status === 'playing' ? 'Pause' : 'Play'}
          >
            {status === 'loading' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : status === 'playing' ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
          <button type="button" className="music-control-btn" onClick={() => void next()} aria-label="Next">
            <SkipForward className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn('music-control-btn', repeat !== 'off' && 'is-active')}
            onClick={cycleRepeat}
            aria-label="Repeat"
          >
            {repeat === 'one' ? <Repeat1 className="h-3.5 w-3.5" /> : <Repeat className="h-3.5 w-3.5" />}
          </button>
          <Volume2 className="ml-1 h-3.5 w-3.5 text-text-muted" aria-hidden />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(event) => setVolume(Number(event.target.value) / 100)}
            className="music-volume w-16"
            aria-label="Volume"
          />
        </div>
      </div>
      <div className="music-progress-rail mt-1 h-0.5 overflow-hidden rounded-full bg-border/40">
        <div className="h-full bg-accent/80 transition-[width]" style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}
