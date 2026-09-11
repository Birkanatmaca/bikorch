import { create } from 'zustand'
import type {
  MusicLibrarySummary,
  MusicPlaybackSnapshot,
  MusicPlaylist,
  MusicSettings,
  MusicTrack,
  PlaybackStatus,
  RepeatMode,
  YouTubeSearchHit
} from '@shared/contracts/music'
import { createDefaultMusicSettings, trackPlaybackUrl } from '@shared/contracts/music'
import type { MusicSource } from '@shared/contracts/music'
import { useWorkspaceStore } from '@renderer/stores/workspace-store'
import { attachPlaybackAnalyser, resumePlaybackAnalyser } from '@renderer/lib/audio-analyser'
import { stopYouTube } from '@renderer/lib/streaming/youtube-player'

function api(): Window['api']['music'] | null {
  return typeof window !== 'undefined' && window.api?.music ? window.api.music : null
}

let youtubeSearchSeq = 0
let playSeq = 0

let audio: HTMLAudioElement | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let listenStartedAt = 0
let activeHistoryId: string | null = null

function prepareAudioElement(element: HTMLAudioElement): HTMLAudioElement {
  element.preload = 'auto'
  element.crossOrigin = 'anonymous'
  attachPlaybackAnalyser(element)
  return element
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = prepareAudioElement(new Audio())
  }
  return audio
}

export function getPlaybackAudioElement(): HTMLAudioElement | null {
  return audio
}

export function readPlaybackClock(): { positionMs: number; durationMs: number } {
  const state = useMusicStore.getState()
  const element = audio
  if (element?.currentSrc && Number.isFinite(element.currentTime)) {
    const hasDuration = Number.isFinite(element.duration) && element.duration > 0
    return {
      positionMs: Math.max(0, Math.floor(element.currentTime * 1000)),
      durationMs: hasDuration ? Math.floor(element.duration * 1000) : state.durationMs
    }
  }
  return { positionMs: state.positionMs, durationMs: state.durationMs }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function playThroughElement(
  trackId: string,
  volume: number,
  seq: number,
  timeoutMs: number,
  skipEnsurePlayable: boolean
): Promise<void> {
  const bridge = api()
  if (!skipEnsurePlayable && bridge?.ensurePlayable) {
    const prepared = await bridge.ensurePlayable(trackId)
    if (!prepared.ok) throw new Error(prepared.error)
    if (seq !== playSeq) return
  }

  const element = getAudio()
  element.pause()
  element.volume = volume
  prepareAudioElement(element)
  await resumePlaybackAnalyser()
  if (seq !== playSeq) return

  element.src = `${trackPlaybackUrl(trackId)}?t=${Date.now()}`
  element.load()
  prepareAudioElement(element)

  try {
    await waitWithTimeout(
      element.play(),
      timeoutMs,
      'This track is taking too long to open.'
    )
  } catch (error) {
    if (seq !== playSeq) return
    if (element.error) throw new Error(mediaErrorMessage(element))
    throw error instanceof Error ? error : new Error('Playback failed')
  }

  if (seq !== playSeq) {
    element.pause()
    return
  }
  await resumePlaybackAnalyser()
}

async function loadPlaybackSource(trackId: string): Promise<void> {
  const bridge = api()
  if (bridge?.ensurePlayable) {
    const prepared = await bridge.ensurePlayable(trackId)
    if (!prepared.ok) throw new Error(prepared.error)
  }
  const element = getAudio()
  element.pause()
  prepareAudioElement(element)
  element.src = `${trackPlaybackUrl(trackId)}?t=${Date.now()}`
  element.load()
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

function bumpRecent(track: MusicTrack, set: (partial: Partial<MusicState> | ((state: MusicState) => Partial<MusicState>)) => void): void {
  const next: MusicTrack = {
    ...track,
    lastPlayedAt: Date.now(),
    playCount: track.playCount + 1
  }
  set((state) => ({
    recent: [
      next,
      ...state.recent.filter((item) => item.id !== next.id && !(next.sourceId && item.sourceId === next.sourceId))
    ].slice(0, 30)
  }))
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
  youtubeResults: YouTubeSearchHit[]
  youtubeSearching: boolean
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
  searchYouTube: (query: string) => Promise<string | null>
  playYouTubeResult: (hit: YouTubeSearchHit) => Promise<string | null>
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
  youtubeResults: [],
  youtubeSearching: false,
  showStreamingPlayer: false,

  bootstrap: async () => {
    const bridge = api()
    if (!bridge || get().loaded) return
    set({ loading: true })
    try {
      const [tracks, playlists, favorites, queue, recent, summary, settings, playback] =
        await Promise.all([
          bridge.library.list(),
          bridge.playlists.list(),
          bridge.favorites.list(),
          bridge.queue.get(),
          bridge.recentlyPlayed(),
          bridge.library.summary(),
          bridge.getSettings(),
          bridge.getPlayback()
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
            await loadPlaybackSource(playback.trackId)
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

  searchYouTube: async (query) => {
    const bridge = api()
    if (!bridge) return 'Music API unavailable'
    const seq = ++youtubeSearchSeq
    set({ youtubeSearching: true })
    try {
      const result = await bridge.youtube.search(query)
      if (seq !== youtubeSearchSeq) return null
      if (!result.ok) {
        set({ youtubeSearching: false, youtubeResults: [] })
        return result.error ?? 'YouTube search failed'
      }
      set({ youtubeSearching: false, youtubeResults: (result.items ?? []).slice(0, 3) })
      return null
    } catch (error) {
      if (seq !== youtubeSearchSeq) return null
      set({ youtubeSearching: false, youtubeResults: [] })
      return error instanceof Error ? error.message : 'YouTube search failed'
    }
  },

  playYouTubeResult: async (hit) => {
    return get().addLink(hit.sourceUrl)
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

    const seq = ++playSeq
    getAudio().pause()
    stopYouTube()
    set({
      status: 'loading',
      error: null,
      currentTrackId: trackId,
      positionMs: 0,
      showStreamingPlayer: false
    })

    if (track) bumpRecent(track, set)
    listenStartedAt = Date.now()
    const projectId = useWorkspaceStore.getState().activeProjectId ?? undefined
    const { historyId } = await bridge.history.recordPlay({ trackId, projectId })
    activeHistoryId = historyId

    try {
      const youtubeStream = track?.source === 'youtube' && Boolean(track.sourceId) && !playsFromFile(track)
      set({ error: youtubeStream ? 'Opening this song…' : 'Preparing this track…' })
      await playThroughElement(
        trackId,
        get().volume,
        seq,
        youtubeStream ? 24_000 : 12_000,
        youtubeStream
      )
      if (seq !== playSeq) return
      set({ status: 'playing', error: null })
      await get().refreshLibrary()
      scheduleSavePlayback(get())
    } catch (error) {
      if (seq !== playSeq) return
      const message = error instanceof Error ? error.message : 'Playback failed'
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
    const element = getAudio()
    try {
      prepareAudioElement(element)
      await resumePlaybackAnalyser()
      if (element.currentSrc) await element.play()
      else await get().playTrack(currentTrackId)
      set({ status: 'playing', error: null })
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : 'Playback failed' })
    }
  },

  pause: () => {
    getAudio().pause()
    stopYouTube()
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
    const element = getAudio()
    if (!element.currentSrc) return
    element.currentTime = positionMs / 1000
    set({ positionMs })
    scheduleSavePlayback(get())
  },

  setVolume: (volume) => {
    const next = Math.min(1, Math.max(0, volume))
    getAudio().volume = next
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
    if (audio && audio !== element) {
      audio.pause()
    }
    audio = prepareAudioElement(element)
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
    await flushListen()
    if (get().repeat === 'one') {
      const element = getAudio()
      element.currentTime = 0
      prepareAudioElement(element)
      await resumePlaybackAnalyser()
      await element.play()
      return
    }
    await get().next()
  },

  handleError: () => {
    if (get().status === 'loading') return
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
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
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
