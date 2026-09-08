/* eslint-disable @typescript-eslint/no-explicit-any */

let apiReady: Promise<void> | null = null
let player: any = null
let readyPromise: Promise<void> | null = null
let onEnded: (() => void) | null = null
let pendingVideoId: string | null = null
let playerContainer: HTMLElement | null = null
let hostWaiters: Array<(el: HTMLElement) => void> = []

const YT_STATE_ENDED = 0

function loadApi(): Promise<void> {
  if (apiReady) return apiReady
  apiReady = new Promise((resolve) => {
    if ((window as any).YT?.Player) {
      resolve()
      return
    }
    ;(window as any).onYouTubeIframeAPIReady = () => resolve()
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(script)
  })
  return apiReady
}

function notifyHostReady(container: HTMLElement): void {
  const waiters = hostWaiters
  hostWaiters = []
  for (const resolve of waiters) resolve(container)
}

function waitForHost(timeoutMs = 8000): Promise<HTMLElement | null> {
  if (playerContainer?.isConnected) return Promise.resolve(playerContainer)
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      hostWaiters = hostWaiters.filter((waiter) => waiter !== onReady)
      resolve(null)
    }, timeoutMs)
    const onReady = (el: HTMLElement): void => {
      window.clearTimeout(timer)
      resolve(el)
    }
    hostWaiters.push(onReady)
  })
}

function resetPlayer(): void {
  try {
    player?.destroy?.()
  } catch {
    // player may already be gone with the DOM
  }
  player = null
  readyPromise = null
}

export function bindYouTubeHost(container: HTMLElement): void {
  if (playerContainer !== container) {
    resetPlayer()
  }
  playerContainer = container
  notifyHostReady(container)
  void ensureYouTubePlayer(container)
}

export function unbindYouTubeHost(container: HTMLElement): void {
  if (playerContainer !== container) return
  resetPlayer()
  playerContainer = null
}

export async function ensureYouTubePlayer(container: HTMLElement): Promise<void> {
  playerContainer = container
  await loadApi()
  if (player) return
  if (!readyPromise) {
    readyPromise = new Promise((resolve) => {
      container.replaceChildren()
      const mount = document.createElement('div')
      mount.style.width = '100%'
      mount.style.height = '100%'
      container.appendChild(mount)
      player = new (window as any).YT.Player(mount, {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          playsinline: 1,
          rel: 0
        },
        events: {
          onReady: () => {
            if (pendingVideoId) {
              player.loadVideoById(pendingVideoId)
              pendingVideoId = null
            }
            resolve()
          },
          onStateChange: (event: { data: number }) => {
            if (event.data === YT_STATE_ENDED) onEnded?.()
          }
        }
      })
    })
  }
  await readyPromise
}

export async function playYouTubeVideo(videoId: string): Promise<void> {
  pendingVideoId = videoId
  const host = playerContainer?.isConnected ? playerContainer : await waitForHost()
  if (!host) throw new Error('Player is not ready yet. Open the Player panel and try again.')
  await ensureYouTubePlayer(host)
  if (!player) throw new Error('The in-app player failed to start.')
  player.loadVideoById(videoId)
  pendingVideoId = null
}

export function pauseYouTube(): void {
  player?.pauseVideo?.()
}

export function resumeYouTube(): void {
  player?.playVideo?.()
}

export function seekYouTube(seconds: number): void {
  player?.seekTo?.(seconds, true)
}

export function setYouTubeVolume(percent: number): void {
  player?.setVolume?.(Math.round(Math.min(100, Math.max(0, percent))))
}

export function getYouTubeTimes(): { currentMs: number; durationMs: number } {
  const current = typeof player?.getCurrentTime === 'function' ? player.getCurrentTime() : 0
  const duration = typeof player?.getDuration === 'function' ? player.getDuration() : 0
  return {
    currentMs: Math.floor(current * 1000),
    durationMs: Math.floor(duration * 1000)
  }
}

export function stopYouTube(): void {
  player?.stopVideo?.()
}

export function setYouTubeEndedHandler(handler: (() => void) | null): void {
  onEnded = handler
}
