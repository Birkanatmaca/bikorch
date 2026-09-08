import { useEffect, useMemo, useRef, useState } from 'react'
import { GripHorizontal, ListMusic, Loader2, Pause, Play, SkipBack, SkipForward, Volume2, X } from 'lucide-react'
import { AudioVisualizer } from '@renderer/components/music/AudioVisualizer'
import { MusicSeekBar } from '@renderer/components/music/MusicSeekBar'
import { useMusicStore } from '@renderer/stores/music-store'
import { cn } from '@renderer/lib/utils'

export function WorkspacePlayerPanel({
  onMoveStart,
  onClose
}: {
  onMoveStart?: (event: React.PointerEvent) => void
  onClose?: () => void
} = {}): React.JSX.Element {
  const [listOpen, setListOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const tracks = useMusicStore((state) => state.tracks)
  const queue = useMusicStore((state) => state.queue)
  const currentTrackId = useMusicStore((state) => state.currentTrackId)
  const status = useMusicStore((state) => state.status)
  const volume = useMusicStore((state) => state.volume)
  const error = useMusicStore((state) => state.error)
  const playTrack = useMusicStore((state) => state.playTrack)
  const togglePlay = useMusicStore((state) => state.togglePlay)
  const next = useMusicStore((state) => state.next)
  const previous = useMusicStore((state) => state.previous)
  const setVolume = useMusicStore((state) => state.setVolume)

  const current = tracks.find((track) => track.id === currentTrackId) ?? null
  const playing = status === 'playing'

  const listTracks = useMemo(() => {
    if (queue.length === 0) return tracks
    return queue
      .map((id) => tracks.find((track) => track.id === id))
      .filter((track): track is NonNullable<typeof track> => Boolean(track))
  }, [queue, tracks])

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
    <div
      className="music-workspace-player"
      onPointerDown={(event) => {
        if (!onMoveStart) return
        const target = event.target as HTMLElement
        if (
          target.closest(
            'button, input, a, .music-player-seek, .music-eq-bezel, .music-player-queue-pop, .music-player-gain'
          )
        ) {
          return
        }
        onMoveStart(event)
      }}
    >
      <div className="music-player-chassis">
        <div className="music-player-move">
          <GripHorizontal className="h-3 w-3 opacity-50" aria-hidden />
          <span>DECK</span>
          {onClose ? (
            <button type="button" className="music-player-close" onClick={onClose} aria-label="Close player">
              <X className="h-3 w-3" />
            </button>
          ) : (
            <span className="music-player-move-spacer" />
          )}
        </div>
        <div className="music-player-copy">
          <span className={cn('music-player-led', playing && 'is-on')} aria-hidden />
          <div className="music-player-lcd">
            <p className="music-player-title">{current?.title ?? 'Nothing playing'}</p>
            <p className="music-player-artist">{error ?? current?.artist ?? 'Choose a track'}</p>
          </div>
        </div>

        <div className="music-eq-bezel">
          <AudioVisualizer playing={playing} />
        </div>

        <div className="music-player-transport">
          <label className="music-player-gain">
            <Volume2 className="h-3 w-3" aria-hidden />
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(event) => setVolume(Number(event.target.value) / 100)}
              className="music-volume"
              aria-label="Volume"
            />
          </label>
          <MusicSeekBar />
          <div className="music-player-controls">
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
      </div>
    </div>
  )
}
