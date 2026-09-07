import { useEffect } from 'react'
import type { MusicSource } from '@shared/contracts/music'
import { useMusicStore } from '@renderer/stores/music-store'
import {
  getYouTubeTimes,
  pauseYouTube,
  resumeYouTube,
  setYouTubeEndedHandler,
  setYouTubeVolume,
  stopYouTube
} from '@renderer/lib/streaming/youtube-player'

/** Hidden streaming controllers. YouTube audio mounts inside the workspace Player. */
export function StreamingPlayerPanel(): React.JSX.Element {
  const currentTrackId = useMusicStore((state) => state.currentTrackId)
  const tracks = useMusicStore((state) => state.tracks)
  const status = useMusicStore((state) => state.status)
  const volume = useMusicStore((state) => state.volume)
  const syncStreamingProgress = useMusicStore((state) => state.syncStreamingProgress)

  const current = tracks.find((track) => track.id === currentTrackId)
  const source: MusicSource | null = current?.source ?? null
  const usesYouTube = source === 'youtube'

  useEffect(() => {
    setYouTubeEndedHandler(() => {
      void useMusicStore.getState().handleEnded()
    })
    return () => setYouTubeEndedHandler(null)
  }, [])

  useEffect(() => {
    if (!usesYouTube || status !== 'playing') return
    const timer = window.setInterval(() => {
      const times = getYouTubeTimes()
      syncStreamingProgress(times.currentMs, times.durationMs)
    }, 500)
    return () => window.clearInterval(timer)
  }, [usesYouTube, status, syncStreamingProgress])

  useEffect(() => {
    if (usesYouTube) setYouTubeVolume(volume * 100)
  }, [usesYouTube, volume])

  useEffect(() => {
    if (!usesYouTube) return
    if (status === 'paused') pauseYouTube()
    if (status === 'playing') resumeYouTube()
    if (status === 'idle') stopYouTube()
  }, [usesYouTube, status])

  return <div className="hidden" aria-hidden />
}
