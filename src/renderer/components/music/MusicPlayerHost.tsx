import { useEffect, useRef } from 'react'
import { useMusicStore } from '@renderer/stores/music-store'
import { StreamingPlayerPanel } from '@renderer/components/music/StreamingPlayerPanel'
/** Hidden audio element wired to the music store. Mount once at app root. */
export function MusicPlayerHost(): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const bindAudioElement = useMusicStore((state) => state.bindAudioElement)
  const handleTimeUpdate = useMusicStore((state) => state.handleTimeUpdate)
  const handleLoadedMetadata = useMusicStore((state) => state.handleLoadedMetadata)
  const handleEnded = useMusicStore((state) => state.handleEnded)
  const handleError = useMusicStore((state) => state.handleError)

  useEffect(() => {
    const element = audioRef.current
    if (!element) return
    bindAudioElement(element)
  }, [bindAudioElement])

  return (
    <div className="pointer-events-none absolute h-0 w-0 overflow-hidden">
      <StreamingPlayerPanel />
      <audio
        ref={audioRef}
        className="hidden"
        crossOrigin="anonymous"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => void handleEnded()}
        onError={handleError}
      />
    </div>
  )
}
