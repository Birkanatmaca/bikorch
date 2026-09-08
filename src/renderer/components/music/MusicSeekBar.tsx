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

export function MusicSeekBar(): React.JSX.Element {
  const playing = useMusicStore((state) => state.status === 'playing')
  const storePosition = useMusicStore((state) => state.positionMs)
  const storeDuration = useMusicStore((state) => state.durationMs)
  const seek = useMusicStore((state) => state.seek)
  const trackRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const totalRef = useRef<HTMLSpanElement>(null)
  const draggingRef = useRef(false)

  const paintFromClock = (): void => {
    const clock = readPlaybackClock()
    applyClock(
      fillRef.current,
      thumbRef.current,
      elapsedRef.current,
      totalRef.current,
      clock.positionMs,
      clock.durationMs || storeDuration
    )
  }

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
  }, [playing, storePosition, storeDuration])

  const seekFromEvent = (event: PointerEvent | React.PointerEvent): void => {
    const track = trackRef.current
    if (!track) return
    const box = track.getBoundingClientRect()
    if (box.width <= 0) return
    const clock = readPlaybackClock()
    const duration = clock.durationMs || storeDuration
    if (duration <= 0) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    const next = Math.round(ratio * duration)
    applyClock(fillRef.current, thumbRef.current, elapsedRef.current, totalRef.current, next, duration)
    seek(next)
  }

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
        aria-valuemax={Math.max(storeDuration, 1)}
        aria-valuenow={storePosition}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.stopPropagation()
          draggingRef.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          seekFromEvent(event)
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return
          seekFromEvent(event)
        }}
        onPointerUp={(event) => {
          draggingRef.current = false
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={() => {
          draggingRef.current = false
        }}
      >
        <div ref={fillRef} className="music-seek-fill" />
        <div ref={thumbRef} className="music-seek-thumb" />
      </div>
      <span ref={totalRef}>{storeDuration > 0 ? formatTrackDuration(storeDuration) : '—'}</span>
    </div>
  )
}
