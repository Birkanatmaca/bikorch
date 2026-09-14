import { useEffect, useRef } from 'react'
import { formatTrackDuration, readPlaybackClock, useMusicStore } from '@renderer/stores/music-store'

function applyClock(
  fill: HTMLDivElement | null,
  thumb: HTMLDivElement | null,
  elapsed: HTMLSpanElement | null,
  total: HTMLSpanElement | null,
  positionMs: number,
  durationMs: number
): void {
  const ratio = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0
  if (fill) fill.style.transform = `translateY(-50%) scaleX(${ratio})`
  if (thumb) thumb.style.left = `${ratio * 100}%`
  if (elapsed) elapsed.textContent = formatTrackDuration(positionMs)
  if (total) total.textContent = durationMs > 0 ? formatTrackDuration(durationMs) : '—'
}

function seekRatioFromClientX(track: HTMLElement, clientX: number): number | null {
  const box = track.getBoundingClientRect()
  // Prefer visual width (transform/zoom safe). Fall back to layout width if rect is stale.
  const width = box.width > 0 ? box.width : track.offsetWidth
  if (width <= 0) return null
  return Math.min(1, Math.max(0, (clientX - box.left) / width))
}

export function MusicSeekBar(): React.JSX.Element {
  const playing = useMusicStore((state) => state.status === 'playing')
  const storePosition = useMusicStore((state) => state.positionMs)
  const storeDuration = useMusicStore((state) => state.durationMs)
  const trackDuration = useMusicStore((state) => {
    const id = state.currentTrackId
    if (!id) return 0
    return state.tracks.find((track) => track.id === id)?.durationMs ?? 0
  })
  const seek = useMusicStore((state) => state.seek)
  const trackRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const totalRef = useRef<HTMLSpanElement>(null)
  const draggingRef = useRef(false)
  const seekFromClientXRef = useRef<(clientX: number) => void>(() => undefined)
  const durationFallback = storeDuration || trackDuration

  const resolveDuration = (): number => {
    const clock = readPlaybackClock()
    return clock.durationMs || storeDuration || trackDuration
  }

  const paintFromClock = (): void => {
    const clock = readPlaybackClock()
    applyClock(
      fillRef.current,
      thumbRef.current,
      elapsedRef.current,
      totalRef.current,
      clock.positionMs,
      clock.durationMs || storeDuration || trackDuration
    )
  }

  const seekFromClientX = (clientX: number): void => {
    const track = trackRef.current
    if (!track) return
    const ratio = seekRatioFromClientX(track, clientX)
    if (ratio == null) return
    const duration = resolveDuration()
    if (duration <= 0) return
    const next = Math.round(ratio * duration)
    applyClock(fillRef.current, thumbRef.current, elapsedRef.current, totalRef.current, next, duration)
    seek(next)
  }
  seekFromClientXRef.current = seekFromClientX

  useEffect(() => {
    paintFromClock()
    if (!playing) return
    let frame = 0
    const tick = (): void => {
      if (!draggingRef.current) paintFromClock()
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [playing, storePosition, storeDuration, trackDuration])

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      if (!draggingRef.current) return
      event.preventDefault()
      seekFromClientXRef.current(event.clientX)
    }
    const onUp = (): void => {
      draggingRef.current = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  return (
    <div className="music-player-seek">
      <span ref={elapsedRef}>{formatTrackDuration(storePosition)}</span>
      <div
        ref={trackRef}
        className="music-seek-track"
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.max(durationFallback, 1)}
        aria-valuenow={storePosition}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.stopPropagation()
          draggingRef.current = true
          seekFromClientX(event.clientX)
        }}
        onKeyDown={(event) => {
          const duration = resolveDuration()
          if (duration <= 0) return
          const step = Math.max(1000, Math.round(duration / 100))
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault()
            seek(Math.max(0, readPlaybackClock().positionMs - step))
          } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault()
            seek(Math.min(duration, readPlaybackClock().positionMs + step))
          } else if (event.key === 'Home') {
            event.preventDefault()
            seek(0)
          } else if (event.key === 'End') {
            event.preventDefault()
            seek(duration)
          }
        }}
      >
        <div ref={fillRef} className="music-seek-fill" />
        <div ref={thumbRef} className="music-seek-thumb" />
      </div>
      <span ref={totalRef}>{durationFallback > 0 ? formatTrackDuration(durationFallback) : '—'}</span>
    </div>
  )
}
