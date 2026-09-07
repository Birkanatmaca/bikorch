import { useEffect, useMemo, useRef, useState } from 'react'
import { ListMusic, Loader2, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { AudioVisualizer } from '@renderer/components/music/AudioVisualizer'
import { formatTrackDuration, useMusicStore } from '@renderer/stores/music-store'
import { bindYouTubeHost, unbindYouTubeHost } from '@renderer/lib/streaming/youtube-player'
import { trackCoverUrl } from '@renderer/lib/track-artwork'
import { cn } from '@renderer/lib/utils'

export function WorkspacePlayerPanel(): React.JSX.Element {
  const [listOpen, setListOpen] = useState(false)
  const [artFailed, setArtFailed] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const youtubeHostRef = useRef<HTMLDivElement>(null)

  const tracks = useMusicStore((state) => state.tracks)
  const queue = useMusicStore((state) => state.queue)
  const currentTrackId = useMusicStore((state) => state.currentTrackId)
  const status = useMusicStore((state) => state.status)
  const positionMs = useMusicStore((state) => state.positionMs)
  const durationMs = useMusicStore((state) => state.durationMs)
  const volume = useMusicStore((state) => state.volume)
  const error = useMusicStore((state) => state.error)
  const spotifyPlayback = useMusicStore((state) => state.spotifyPlayback)
  const settings = useMusicStore((state) => state.settings)
  const spotifyDevices = useMusicStore((state) => state.spotifyDevices)
  const playTrack = useMusicStore((state) => state.playTrack)
  const togglePlay = useMusicStore((state) => state.togglePlay)
  const next = useMusicStore((state) => state.next)
  const previous = useMusicStore((state) => state.previous)
  const seek = useMusicStore((state) => state.seek)
  const setVolume = useMusicStore((state) => state.setVolume)

  const current = tracks.find((track) => track.id === currentTrackId) ?? null
  const playing = status === 'playing'
  const spotifyDevice =
    spotifyDevices.find((device) => device.id === settings.spotifyDeviceId)?.name ??
    spotifyPlayback?.deviceName
  const total = durationMs || current?.durationMs || 0
  const cover = trackCoverUrl(current)

  const listTracks = useMemo(() => {
    if (queue.length === 0) return tracks
    return queue
      .map((id) => tracks.find((track) => track.id === id))
      .filter((track): track is NonNullable<typeof track> => Boolean(track))
  }, [queue, tracks])

  useEffect(() => {
    setArtFailed(false)
  }, [currentTrackId, current?.artworkPath])

  useEffect(() => {
    const host = youtubeHostRef.current
    if (!host) return
    bindYouTubeHost(host)
    return () => unbindYouTubeHost(host)
  }, [])

  useEffect(() => {
    if (!listOpen) return
    const onPointer = (event: PointerEvent): void => {
      if (listRef.current && !listRef.current.contains(event.target as Node)) {
        setListOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [listOpen])

  return (
    <div className="music-workspace-player">
      <div ref={youtubeHostRef} className="music-player-video is-idle" />

      <div className="music-player-stage">
        <div className="music-player-cover" aria-hidden>
          {cover && !artFailed ? (
            <img src={cover} alt="" onError={() => setArtFailed(true)} />
          ) : (
            <div className="music-player-cover-empty">
              <span>NO</span>
              <span>DISC</span>
            </div>
          )}
        </div>

        <div className="music-player-deck">
          <div className="music-player-copy">
            <p className="truncate text-[15px] font-semibold tracking-wide text-text-primary">
              {current?.title ?? 'Nothing playing'}
            </p>
            <p className="truncate text-[11px] text-text-muted">
              {error ??
                (current?.source === 'spotify' && spotifyDevice
                  ? `${current.artist ?? 'Spotify'} · on ${spotifyDevice}`
                  : current?.artist ?? 'Choose a track from the list')}
            </p>
          </div>
          <div className="music-eq-bezel">
            <AudioVisualizer playing={playing} positionMs={positionMs} />
          </div>
        </div>
      </div>

      <div className="music-player-transport">
        <button type="button" className="music-control-btn" onClick={() => void previous()} aria-label="Previous">
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="music-player-play"
          onClick={() => void togglePlay()}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {status === 'loading' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </button>
        <button type="button" className="music-control-btn" onClick={() => void next()} aria-label="Next">
          <SkipForward className="h-3.5 w-3.5" />
        </button>
        <span className="w-10 text-[10px] tabular-nums text-text-muted">{formatTrackDuration(positionMs)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(total, 1)}
          value={Math.min(positionMs, total)}
          onChange={(event) => seek(Number(event.target.value))}
          className="music-progress flex-1"
          aria-label="Seek"
        />
        <span className="w-10 text-right text-[10px] tabular-nums text-text-muted">
          {formatTrackDuration(total)}
        </span>
        <Volume2 className="h-3.5 w-3.5 text-text-muted" aria-hidden />
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(event) => setVolume(Number(event.target.value) / 100)}
          className="music-volume w-16"
          aria-label="Volume"
        />

        <div className="music-player-queue" ref={listRef}>
          <button
            type="button"
            className={cn('music-player-queue-btn', listOpen && 'is-open')}
            onClick={() => setListOpen((open) => !open)}
            aria-expanded={listOpen}
            aria-label="Song list"
          >
            <ListMusic className="h-3.5 w-3.5" />
          </button>
          {listOpen && (
            <div className="music-player-queue-pop">
              <p className="music-player-queue-title">Songs</p>
              {listTracks.length === 0 ? (
                <p className="px-2 py-3 text-[10px] text-text-muted">Library is empty.</p>
              ) : (
                <div className="music-player-queue-scroll">
                  {listTracks.map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      className={cn('music-player-list-item', track.id === currentTrackId && 'is-active')}
                      onClick={() => {
                        void playTrack(track.id)
                        setListOpen(false)
                      }}
                    >
                      <span className="truncate">{track.title}</span>
                      <span className="truncate text-text-muted">{track.artist ?? 'Unknown'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
