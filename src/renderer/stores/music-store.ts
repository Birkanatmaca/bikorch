import { create } from 'zustand'
import type {
  MusicLibrarySummary,
  MusicPlaybackSnapshot,
  MusicPlaylist,
  MusicSettings,
  MusicTrack,
  PlaybackStatus,
  RepeatMode
} from '@shared/contracts/music'
import { createDefaultMusicSettings, trackPlaybackUrl } from '@shared/contracts/music'
import type { MusicSource, SpotifyCatalogTrack, SpotifyConnectionStatus, SpotifyTimeRange } from '@shared/contracts/music'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { attachPlaybackAnalyser, resumePlaybackAnalyser } from '@renderer/lib/audio-analyser'
import { pauseYouTube, playYouTubeVideo, resumeYouTube, seekYouTube, setYouTubeVolume, stopYouTube } from '@renderer/lib/streaming/youtube-player'
import { disconnectSpotifyPlayer, pauseSpotify, playSpotifyTrack, resumeSpotify, setSpotifyVolume } from '@renderer/lib/streaming/spotify-player'

function api(): Window['api']['music'] | null {
  return typeof window !== 'undefined' && window.api?.music ? window.api.music : null
}

let audio: HTMLAudioElement | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let listenStartedAt = 0
let activeHistoryId: string | null = null

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'auto'
  }
  return audio
}

export function getPlaybackAudioElement(): HTMLAudioElement | null {
  return audio
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function waitForAudioReady(element: HTMLAudioElement, timeoutMs = 12_000): Promise<void> {
  if (element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('This track could not be decoded.'))
    }, timeoutMs)
    const onReady = (): void => {
      cleanup()
      resolve()
    }
    const onError = (): void => {
      cleanup()
      reject(new Error(mediaErrorMessage(element)))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      element.removeEventListener('canplay', onReady)
      element.removeEventListener('error', onError)
    }
    element.addEventListener('canplay', onReady, { once: true })
    element.addEventListener('error', onError, { once: true })
  })
}

async function loadLocalPlayback(trackId: string, cors: boolean): Promise<HTMLAudioElement> {
  const bridge = api()
  if (bridge?.ensurePlayable) {
    const prepared = await bridge.ensurePlayable(trackId)
    if (!prepared.ok) throw new Error(prepared.error)
  }
  const element = getAudio()
  element.pause()
  if (cors) element.crossOrigin = 'anonymous'
  else element.removeAttribute('crossorigin')
  element.src = `${trackPlaybackUrl(trackId)}?t=${Date.now()}`
  element.load()
  return element
}

async function playLocalFile(trackId: string, volume: number): Promise<void> {
  const start = async (cors: boolean): Promise<HTMLAudioElement> => {
    const element = await loadLocalPlayback(trackId, cors)
    element.volume = volume
    await waitForAudioReady(element, cors ? 6_000 : 12_000)
    await element.play()
    attachPlaybackAnalyser(element)
    await resumePlaybackAnalyser()
    return element
  }
  try {
    await start(true)
  } catch {
    try {
      await start(false)
    } catch {
      throw new Error(mediaErrorMessage(getAudio()))
    }
  }
}

function mediaErrorMessage(element: HTMLAudioElement): string {
  const code = element.error?.code
  if (code === 4) return 'This track could not be decoded.'
  if (code === 3) return 'The audio file looks incomplete or damaged.'
  if (code === 2) return 'The audio file could not be loaded.'
  return 'Audio file could not be played'
}

function trackById(tracks: MusicTrack[], id: string | null): MusicTrack | null {
  if (!id) return null
  return tracks.find((track) => track.id === id) ?? null
}

function playsFromFile(track: MusicTrack | null): boolean {
  return Boolean(track?.isOfflineAvailable && track.filePath)
}

function playsSpotifyViaYouTube(track: MusicTrack | null, videoId: string | null): boolean {
  return Boolean(track?.source === 'spotify' && videoId)
}

function buildPlayOrder(state: MusicState): string[] {
  const ids = state.queue.length > 0 ? state.queue : state.tracks.map((track) => track.id)
  if (!state.shuffle) return ids
  const current = state.currentTrackId
  const rest = ids.filter((id) => id !== current)
  for (let index = rest.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[rest[index], rest[swap]] = [rest[swap], rest[index]]
  }
  return current ? [current, ...rest.filter((id) => id !== current)] : rest
}

interface MusicState {
  loaded: boolean
  loading: boolean
  tracks: MusicTrack[]
  playlists: MusicPlaylist[]
  favoriteIds: Set<string>
  queue: string[]
  recent: MusicTrack[]
  summary: MusicLibrarySummary | null
  settings: MusicSettings
  activeSection: 'library' | 'playlists' | 'queue' | 'recent' | 'favorites' | 'settings' | 'downloads'
  selectedPlaylistId: string | null
  playlistTracks: MusicTrack[]
  searchQuery: string
  currentTrackId: string | null
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  error: string | null
  spotifyStatus: SpotifyConnectionStatus | null
  spotifyYouTubeId: string | null
  showStreamingPlayer: boolean

  bootstrap: () => Promise<void>
  refreshLibrary: () => Promise<void>
  setSection: (section: MusicState['activeSection']) => void
  setSearchQuery: (query: string) => void
  search: (query: string) => Promise<void>
  selectPlaylist: (playlistId: string | null) => Promise<void>
  importFiles: () => Promise<void>
  importFolder: () => Promise<void>
  importPaths: (paths: string[]) => Promise<void>
  addLink: (url: string) => Promise<string | null>
  openExternal: (url: string) => Promise<void>
  refreshSpotifyStatus: () => Promise<void>
  setSpotifyClientId: (clientId: string) => Promise<void>
  connectSpotify: () => Promise<string | null>
  disconnectSpotify: () => Promise<void>
  loadSpotifyTopTracks: (timeRange?: SpotifyTimeRange, limit?: number) => Promise<string | null>
  importSpotifyTopTracks: (timeRange?: SpotifyTimeRange, limit?: number) => Promise<string | null>
  playSpotifyCatalogTrack: (sourceId: string) => Promise<string | null>
  spotifyTopTracks: SpotifyCatalogTrack[]
  removeTrack: (trackId: string) => Promise<void>
  createPlaylist: (name: string) => Promise<void>
  renamePlaylist: (id: string, name: string) => Promise<void>
  deletePlaylist: (id: string) => Promise<void>
  addToPlaylist: (playlistId: string, trackIds: string[]) => Promise<void>
  toggleFavorite: (trackId: string) => Promise<void>
  addToQueue: (trackIds: string[]) => Promise<void>
  removeFromQueue: (trackId: string) => Promise<void>
  clearQueue: () => Promise<void>
  playTrack: (trackId: string, options?: { replaceQueue?: boolean; queue?: string[] }) => Promise<void>
  playPlaylist: (playlistId: string, startTrackId?: string) => Promise<void>
  togglePlay: () => Promise<void>
  pause: () => void
  next: () => Promise<void>
  previous: () => Promise<void>
  seek: (positionMs: number) => void
  setVolume: (volume: number) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  updateSettings: (updates: Partial<MusicSettings>) => Promise<void>
  bindAudioElement: (element: HTMLAudioElement) => void
  handleTimeUpdate: () => void
  handleLoadedMetadata: () => void
  handleEnded: () => Promise<void>
  handleError: () => void
  syncStreamingProgress: (positionMs: number, durationMs: number) => void
  currentSource: () => MusicSource | null
}

export const useMusicStore = create<MusicState>((set, get) => ({
  loaded: false,
  loading: false,
  tracks: [],
  playlists: [],
  favoriteIds: new Set<string>(),
  queue: [],
  recent: [],
  summary: null,
  settings: createDefaultMusicSettings(),
  activeSection: 'library',
  selectedPlaylistId: null,
  playlistTracks: [],
  searchQuery: '',
  currentTrackId: null,
  status: 'idle',
  positionMs: 0,
  durationMs: 0,
  volume: 0.8,
  shuffle: false,
  repeat: 'off',
  error: null,
  spotifyStatus: null,
  spotifyYouTubeId: null,
  spotifyTopTracks: [],
  showStreamingPlayer: false,

  bootstrap: async () => {
    const bridge = api()
    if (!bridge || get().loaded) return
    set({ loading: true })
    try {
      const [tracks, playlists, favorites, queue, recent, summary, settings, playback, spotifyStatus] =
        await Promise.all([
          bridge.library.list(),
          bridge.playlists.list(),
          bridge.favorites.list(),
          bridge.queue.get(),
          bridge.recentlyPlayed(),
          bridge.library.summary(),
          bridge.getSettings(),
          bridge.getPlayback(),
          bridge.spotify.status()
        ])
      set({
        loaded: true,
        loading: false,
        tracks,
        playlists,
        favoriteIds: new Set(favorites.map((track) => track.id)),
        queue,
        recent,
        summary,
        settings,
        spotifyStatus,
        volume: playback?.volume ?? 0.8,
        shuffle: playback?.shuffle ?? false,
        repeat: playback?.repeat ?? 'off',
        currentTrackId: playback?.trackId ?? null,
        positionMs: playback?.positionMs ?? 0
      })
      const element = getAudio()
      element.volume = playback?.volume ?? 0.8
      if (playback?.trackId) {
        const check = await bridge.checkTrack(playback.trackId)
        if (check.ok) {
          try {
            await loadLocalPlayback(playback.trackId, false)
            element.currentTime = (playback.positionMs ?? 0) / 1000
          } catch {
            // restore without audio buffer if the file cannot be read yet
          }
        }
      }
    } catch {
      set({ loading: false, loaded: true })
    }
  },

  refreshLibrary: async () => {
    const bridge = api()
    if (!bridge) return
    const [tracks, summary, recent, favorites] = await Promise.all([
      bridge.library.list(),
      bridge.library.summary(),
      bridge.recentlyPlayed(),
      bridge.favorites.list()
    ])
    set({
      tracks,
      summary,
      recent,
      favoriteIds: new Set(favorites.map((track) => track.id))
    })
  },

  setSection: (section) => set({ activeSection: section }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  search: async (query) => {
    const bridge = api()
    if (!bridge) return
    const tracks = query.trim() ? await bridge.library.search(query.trim()) : await bridge.library.list()
    set({ tracks, searchQuery: query })
  },

  selectPlaylist: async (playlistId) => {
    const bridge = api()
    if (!bridge || !playlistId) {
      set({ selectedPlaylistId: null, playlistTracks: [] })
      return
    }
    const playlistTracks = await bridge.playlists.getTracks(playlistId)
    set({ selectedPlaylistId: playlistId, playlistTracks, activeSection: 'playlists' })
  },

  importFiles: async () => {
    const bridge = api()
    if (!bridge) return
    const result = await bridge.library.importFiles(get().settings.libraryMode)
    if ('canceled' in result && result.canceled) return
    await get().refreshLibrary()
    if (result.tracks[0]) await get().playTrack(result.tracks[0].id)
  },

  importFolder: async () => {
    const bridge = api()
    if (!bridge) return
    const result = await bridge.library.importFolder(get().settings.libraryMode)
    if ('canceled' in result && result.canceled) return
    await get().refreshLibrary()
    if (result.tracks[0]) await get().playTrack(result.tracks[0].id)
  },

  importPaths: async (paths) => {
    const bridge = api()
    if (!bridge || paths.length === 0) return
    const result = await bridge.library.importPaths({ paths, mode: get().settings.libraryMode })
    await get().refreshLibrary()
    if (result.tracks[0]) await get().playTrack(result.tracks[0].id)
  },

  addLink: async (url) => {
    const bridge = api()
    if (!bridge) return 'Music API unavailable'
    const result = await bridge.addLink(url)
    if (!result.ok) return result.error ?? 'Could not add link'
    await get().refreshLibrary()
    if (result.track) await get().playTrack(result.track.id)
    return null
  },

  openExternal: async (url) => {
    await api()?.openExternal(url)
  },

  refreshSpotifyStatus: async () => {
    const bridge = api()
    if (!bridge) return
    const spotifyStatus = await bridge.spotify.status()
    set({ spotifyStatus })
  },

  setSpotifyClientId: async (clientId) => {
    const bridge = api()
    if (!bridge) return
    const spotifyStatus = await bridge.spotify.setClientId(clientId)
    set({ spotifyStatus })
  },

  connectSpotify: async () => {
    const bridge = api()
    if (!bridge) return 'Music API unavailable'
    const result = await bridge.spotify.connect()
    await get().refreshSpotifyStatus()
    return result.ok ? null : result.error ?? 'Spotify connection failed'
  },

  disconnectSpotify: async () => {
    const bridge = api()
    if (!bridge) return
    disconnectSpotifyPlayer()
    await bridge.spotify.disconnect()
    set({ spotifyTopTracks: [] })
    await get().refreshSpotifyStatus()
  },

  loadSpotifyTopTracks: async (timeRange = 'long_term', limit = 5) => {
    const bridge = api()
    if (!bridge?.spotify.topTracks) return 'Music API unavailable'
    try {
      const spotifyTopTracks = await bridge.spotify.topTracks({ timeRange, limit })
      set({ spotifyTopTracks })
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not load Spotify top tracks'
    }
  },

  importSpotifyTopTracks: async (timeRange = 'long_term', limit = 5) => {
    const bridge = api()
    if (!bridge?.spotify.importTop) return 'Music API unavailable'
    try {
      await bridge.spotify.importTop({ timeRange, limit })
      await get().refreshLibrary()
      await get().loadSpotifyTopTracks(timeRange, limit)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not add Spotify tracks'
    }
  },

  playSpotifyCatalogTrack: async (sourceId) => {
    const bridge = api()
    if (!bridge?.spotify.importOne) return 'Music API unavailable'
    const result = await bridge.spotify.importOne(sourceId)
    if (!result.ok) return result.error
    await get().refreshLibrary()
    await get().playTrack(result.track.id)
    return null
  },

  removeTrack: async (trackId) => {
    const bridge = api()
    if (!bridge) return
    if (get().currentTrackId === trackId) {
      get().pause()
      set({ currentTrackId: null, status: 'idle', positionMs: 0, durationMs: 0 })
    }
    await bridge.library.remove(trackId)
    await get().refreshLibrary()
    void import('@renderer/stores/download-store').then(({ useDownloadStore }) => {
      void useDownloadStore.getState().refresh()
    })
  },

  createPlaylist: async (name) => {
    const bridge = api()
    if (!bridge) return
    const playlist = await bridge.playlists.create({ name })
    if (playlist) set({ playlists: [playlist, ...get().playlists] })
  },

  renamePlaylist: async (id, name) => {
    const bridge = api()
    if (!bridge) return
    await bridge.playlists.rename({ id, name })
    set({
      playlists: get().playlists.map((playlist) =>
        playlist.id === id ? { ...playlist, name, updatedAt: Date.now() } : playlist
      )
    })
  },

  deletePlaylist: async (id) => {
    const bridge = api()
    if (!bridge) return
    await bridge.playlists.delete(id)
    set({
      playlists: get().playlists.filter((playlist) => playlist.id !== id),
      selectedPlaylistId: get().selectedPlaylistId === id ? null : get().selectedPlaylistId,
      playlistTracks: get().selectedPlaylistId === id ? [] : get().playlistTracks
    })
  },

  addToPlaylist: async (playlistId, trackIds) => {
    const bridge = api()
    if (!bridge) return
    await bridge.playlists.addTracks(playlistId, trackIds)
    if (get().selectedPlaylistId === playlistId) await get().selectPlaylist(playlistId)
  },

  toggleFavorite: async (trackId) => {
    const bridge = api()
    if (!bridge) return
    const { favorited } = await bridge.favorites.toggle(trackId)
    const favoriteIds = new Set(get().favoriteIds)
    if (favorited) favoriteIds.add(trackId)
    else favoriteIds.delete(trackId)
    set({ favoriteIds })
  },

  addToQueue: async (trackIds) => {
    const bridge = api()
    if (!bridge) return
    await bridge.queue.add(trackIds)
    set({ queue: [...get().queue, ...trackIds.filter((id) => !get().queue.includes(id))] })
  },

  removeFromQueue: async (trackId) => {
    const bridge = api()
    if (!bridge) return
    await bridge.queue.remove(trackId)
    set({ queue: get().queue.filter((id) => id !== trackId) })
  },

  clearQueue: async () => {
    const bridge = api()
    if (!bridge) return
    await bridge.queue.clear()
    set({ queue: [] })
  },

  playTrack: async (trackId, options) => {
    const bridge = api()
    if (!bridge) return
    useWorkspaceStore.getState().openPlayerPanel()
    const track = get().tracks.find((item) => item.id === trackId) ?? null
    const check = await bridge.checkTrack(trackId)
    if (!check.ok) {
      set({ status: 'error', error: check.reason ?? 'Cannot play track' })
      return
    }

    if (options?.queue) {
      await bridge.queue.set(options.queue)
      set({ queue: options.queue })
    } else if (options?.replaceQueue) {
      await bridge.queue.set([trackId])
      set({ queue: [trackId] })
    } else if (!get().queue.includes(trackId)) {
      await get().addToQueue([trackId])
    }

    getAudio().pause()
    stopYouTube()
    set({
      status: 'loading',
      error: null,
      currentTrackId: trackId,
      positionMs: 0,
      showStreamingPlayer: !playsFromFile(track) && (track?.source === 'youtube' || track?.source === 'spotify'),
      spotifyYouTubeId: null
    })

    try {
      if (playsFromFile(track)) {
        set({ error: 'Preparing this track…' })
        await playLocalFile(trackId, get().volume)
        set({ status: 'playing', error: null })
        void get().refreshLibrary()
      } else if (track?.source === 'youtube' && track.sourceId) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
        await playYouTubeVideo(track.sourceId)
        set({ status: 'playing' })
      } else if (track?.source === 'spotify') {
        console.log('[spotify] store playTrack', track.title, track.sourceId)
        set({ error: 'Finding a playable copy…' })
        const resolved = await bridge.spotify.resolvePlayback({
          title: track.title,
          ...(track.artist ? { artist: track.artist } : {}),
          ...(track.sourceId ? { sourceId: track.sourceId } : {})
        })
        if (!resolved.ok) throw new Error(resolved.error)
        console.log('[spotify] playing via YouTube', resolved.videoId)
        set({ spotifyYouTubeId: resolved.videoId, error: null })
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
        await playYouTubeVideo(resolved.videoId)
        set({ status: 'playing', durationMs: track.durationMs ?? 0 })
      } else {
        await playLocalFile(trackId, get().volume)
        set({ status: 'playing' })
      }

      listenStartedAt = Date.now()
      const projectId = useWorkspaceStore.getState().activeProjectId ?? undefined
      const { historyId } = await bridge.history.recordPlay({ trackId, projectId })
      activeHistoryId = historyId
      await get().refreshLibrary()
      scheduleSavePlayback(get())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Playback failed'
      if (track?.source === 'spotify') {
        console.error('[spotify] store playTrack failed', message)
      }
      set({
        status: 'error',
        error: message
      })
    }
  },

  playPlaylist: async (playlistId, startTrackId) => {
    const bridge = api()
    if (!bridge) return
    const tracks = await bridge.playlists.getTracks(playlistId)
    if (tracks.length === 0) return
    const ids = tracks.map((track) => track.id)
    const start = startTrackId && ids.includes(startTrackId) ? startTrackId : ids[0]
    await get().playTrack(start, { queue: ids })
  },

  togglePlay: async () => {
    const { status, currentTrackId } = get()
    if (!currentTrackId) {
      const first = get().queue[0] ?? get().tracks[0]?.id
      if (first) await get().playTrack(first)
      return
    }
    if (status === 'playing') {
      get().pause()
      return
    }
    useWorkspaceStore.getState().openPlayerPanel()
    const current = trackById(get().tracks, currentTrackId)
    if (!playsFromFile(current)) {
      const source = current?.source
      if (source === 'youtube' || playsSpotifyViaYouTube(current, get().spotifyYouTubeId)) {
        set({ status: 'playing', error: null })
        resumeYouTube()
        return
      }
      if (source === 'spotify') {
        await get().playTrack(currentTrackId)
        return
      }
    }
    const element = getAudio()
    try {
      attachPlaybackAnalyser(element)
      await resumePlaybackAnalyser()
      await element.play()
      set({ status: 'playing', error: null })
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : 'Playback failed' })
    }
  },

  pause: () => {
    const source = get().currentSource()
    getAudio().pause()
    if (source === 'youtube' || get().spotifyYouTubeId) pauseYouTube()
    if (source === 'spotify' && !get().spotifyYouTubeId) void pauseSpotify()
    set({ status: 'paused' })
    void flushListen()
    scheduleSavePlayback(get())
  },

  next: async () => {
    const state = get()
    const order = buildPlayOrder(state)
    const index = state.currentTrackId ? order.indexOf(state.currentTrackId) : -1
    if (state.repeat === 'one' && state.currentTrackId) {
      await get().playTrack(state.currentTrackId)
      return
    }
    const nextId = index >= 0 && index < order.length - 1 ? order[index + 1] : order[0]
    if (!nextId || (nextId === state.currentTrackId && state.repeat !== 'all')) return
    await get().playTrack(nextId)
  },

  previous: async () => {
    const element = getAudio()
    if (element.currentTime > 3) {
      element.currentTime = 0
      set({ positionMs: 0 })
      return
    }
    const state = get()
    const order = buildPlayOrder(state)
    const index = state.currentTrackId ? order.indexOf(state.currentTrackId) : -1
    const prevId = index > 0 ? order[index - 1] : order[order.length - 1]
    if (prevId) await get().playTrack(prevId)
  },

  seek: (positionMs) => {
    const current = trackById(get().tracks, get().currentTrackId)
    if (!playsFromFile(current)) {
      const source = current?.source
      if (source === 'youtube' || playsSpotifyViaYouTube(current, get().spotifyYouTubeId)) {
        seekYouTube(positionMs / 1000)
        set({ positionMs })
        scheduleSavePlayback(get())
        return
      }
      if (source === 'spotify') {
        set({ positionMs })
        scheduleSavePlayback(get())
        return
      }
    }
    const element = getAudio()
    element.currentTime = positionMs / 1000
    set({ positionMs })
    scheduleSavePlayback(get())
  },

  setVolume: (volume) => {
    const next = Math.min(1, Math.max(0, volume))
    const source = get().currentSource()
    getAudio().volume = next
    if (source === 'youtube' || get().spotifyYouTubeId) setYouTubeVolume(next * 100)
    if (source === 'spotify' && !get().spotifyYouTubeId) void setSpotifyVolume(next)
    set({ volume: next })
    scheduleSavePlayback(get())
  },

  toggleShuffle: () => {
    set({ shuffle: !get().shuffle })
    scheduleSavePlayback(get())
  },

  cycleRepeat: () => {
    const next: RepeatMode = get().repeat === 'off' ? 'all' : get().repeat === 'all' ? 'one' : 'off'
    set({ repeat: next })
    scheduleSavePlayback(get())
  },

  updateSettings: async (updates) => {
    const bridge = api()
    if (!bridge) return
    const settings = await bridge.updateSettings(updates)
    set({ settings })
  },

  bindAudioElement: (element) => {
    audio = element
    element.volume = get().volume
  },

  handleTimeUpdate: () => {
    const element = getAudio()
    set({ positionMs: Math.floor(element.currentTime * 1000) })
  },

  handleLoadedMetadata: () => {
    const element = getAudio()
    const durationMs = Number.isFinite(element.duration) ? Math.floor(element.duration * 1000) : 0
    set({ durationMs })
    const trackId = get().currentTrackId
    const bridge = api()
    if (trackId && durationMs > 0 && bridge) {
      const track = trackById(get().tracks, trackId)
      if (!track?.durationMs) void bridge.library.updateDuration(trackId, durationMs)
    }
  },

  handleEnded: async () => {
    const source = get().currentSource()
    await flushListen()
    if (get().repeat === 'one') {
      if (source === 'youtube' || source === 'spotify') {
        await get().playTrack(get().currentTrackId!)
        return
      }
      getAudio().currentTime = 0
      await getAudio().play()
      return
    }
    await get().next()
  },

  handleError: () => {
    set({ status: 'error', error: mediaErrorMessage(getAudio()) })
  },

  syncStreamingProgress: (positionMs, durationMs) => {
    set({ positionMs, ...(durationMs > 0 ? { durationMs } : {}) })
  },

  currentSource: () => {
    const track = trackById(get().tracks, get().currentTrackId)
    return track?.source ?? null
  }
}))

async function flushListen(): Promise<void> {
  const bridge = api()
  if (!bridge || !activeHistoryId) return
  const listenedMs = Math.max(0, Date.now() - listenStartedAt)
  if (listenedMs < 1000) return
  await bridge.history.recordListen(activeHistoryId, listenedMs)
  activeHistoryId = null
}

function scheduleSavePlayback(state: MusicState): void {
  const bridge = api()
  if (!bridge || !state.settings.persistQueue) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const snapshot: MusicPlaybackSnapshot = {
      trackId: state.currentTrackId,
      positionMs: state.positionMs,
      volume: state.volume,
      shuffle: state.shuffle,
      repeat: state.repeat,
      queueTrackIds: state.queue,
      updatedAt: Date.now()
    }
    void bridge.savePlayback(snapshot)
  }, 600)
}

export function formatTrackDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—'
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`
}

export function formatLibrarySize(bytes: number): string {
  return formatBytes(bytes)
}

export function favoriteTracks(tracks: MusicTrack[], favoriteIds: Set<string>): MusicTrack[] {
  return tracks.filter((track) => favoriteIds.has(track.id))
}
