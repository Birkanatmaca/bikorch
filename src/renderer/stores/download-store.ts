import { create } from 'zustand'
import type {
  DownloadEngineStatus,
  DownloadJob,
  DownloadMode,
  DownloadRequest,
  DownloadSettings,
  MediaAnalysis
} from '@shared/contracts/downloads'
import { createDefaultDownloadSettings } from '@shared/contracts/downloads'

function api(): Window['api']['music']['downloads'] | null {
  return typeof window !== 'undefined' && window.api?.music?.downloads ? window.api.music.downloads : null
}

interface DownloadState {
  loaded: boolean
  jobs: DownloadJob[]
  settings: DownloadSettings
  engine: DownloadEngineStatus | null
  url: string
  analysis: MediaAnalysis | null
  analyzing: boolean
  analyzeError: string | null
  mode: DownloadMode
  formatId: string | null
  importToLibrary: boolean
  playlistId: string | null
  starting: boolean
  installing: boolean
  installError: string | null

  bootstrap: () => Promise<void>
  refresh: () => Promise<void>
  setUrl: (url: string) => void
  analyze: () => Promise<void>
  setMode: (mode: DownloadMode) => void
  setFormatId: (formatId: string) => void
  setImportToLibrary: (value: boolean) => void
  setPlaylistId: (id: string | null) => void
  start: () => Promise<string | null>
  downloadFromUrl: (url?: string) => Promise<string | null>
  cancel: (jobId: string) => Promise<void>
  retry: (jobId: string) => Promise<void>
  deleteJob: (jobId: string) => Promise<string | null>
  clearHistory: () => Promise<void>
  updateSettings: (updates: Partial<DownloadSettings>) => Promise<void>
  pickFolder: () => Promise<void>
  openFile: (jobId: string) => Promise<void>
  openFolder: (jobId: string) => Promise<void>
  openDir: () => Promise<void>
  copyPath: (jobId: string) => Promise<string | null>
  installEngine: () => Promise<string | null>
}

function preferredFormatId(
  analysis: MediaAnalysis,
  mode: DownloadMode,
  _audioPreference: DownloadSettings['defaultAudioFormat'],
  videoPreference: DownloadSettings['defaultVideoQuality']
): string | null {
  if (mode === 'audio') {
    return (
      analysis.audioFormats.find((item) => item.ext === 'm4a')?.id ??
      analysis.audioFormats[0]?.id ??
      null
    )
  }
  if (videoPreference !== 'best') {
    const match = analysis.videoFormats.find((item) => item.resolution === `${videoPreference}p`)
    if (match) return match.id
  }
  return analysis.videoFormats[0]?.id ?? null
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  loaded: false,
  jobs: [],
  settings: createDefaultDownloadSettings(),
  engine: null,
  url: '',
  analysis: null,
  analyzing: false,
  analyzeError: null,
  mode: 'audio',
  formatId: null,
  importToLibrary: true,
  playlistId: null,
  starting: false,
  installing: false,
  installError: null,

  bootstrap: async () => {
    const bridge = api()
    if (!bridge || get().loaded) return
    const [jobs, settings, engine] = await Promise.all([
      bridge.list(),
      bridge.getSettings(),
      bridge.engineStatus()
    ])
    set({
      loaded: true,
      jobs,
      settings,
      engine,
      importToLibrary: settings.importAudioToLibrary
    })
    bridge.onEvent((event) => {
      if (event.type === 'removed' && event.job) {
        set({ jobs: get().jobs.filter((job) => job.id !== event.job?.id) })
        void import('@renderer/stores/music-store').then(({ useMusicStore }) => {
          void useMusicStore.getState().refreshLibrary()
        })
        return
      }
      if (event.type === 'updated' && event.job) {
        set({
          jobs: [event.job, ...get().jobs.filter((job) => job.id !== event.job?.id)]
        })
        if (event.job.status === 'completed') {
          void import('@renderer/stores/music-store').then(({ useMusicStore }) => {
            const music = useMusicStore.getState()
            if (event.job?.trackId) {
              void music.refreshLibrary()
              return
            }
            if (event.job?.mode === 'audio' && event.job.outputPath) {
              void music.importPaths([event.job.outputPath])
            }
          })
        }
      }
    })
  },

  refresh: async () => {
    const bridge = api()
    if (!bridge) return
    const [jobs, settings, engine] = await Promise.all([
      bridge.list(),
      bridge.getSettings(),
      bridge.engineStatus()
    ])
    set({ jobs, settings, engine })
  },

  setUrl: (url) => set({ url, analyzeError: null }),

  analyze: async () => {
    const bridge = api()
    const url = get().url.trim()
    if (!bridge || !url) return
    set({ analyzing: true, analyzeError: null, analysis: null })
    try {
      const result = await bridge.analyze(url)
      if (!result.ok || !result.analysis) {
        set({ analyzing: false, analyzeError: result.error ?? 'Could not analyze this URL' })
        return
      }
      const settings = get().settings
      const mode =
        get().mode === 'video' && result.analysis.videoFormats.length > 0
          ? 'video'
          : result.analysis.audioFormats.length > 0
            ? 'audio'
            : 'video'
      const formatId = preferredFormatId(
        result.analysis,
        mode,
        settings.defaultAudioFormat,
        settings.defaultVideoQuality
      )
      set({
        analyzing: false,
        analysis: result.analysis,
        mode,
        formatId
      })
    } catch (error) {
      set({
        analyzing: false,
        analyzeError: error instanceof Error ? error.message : 'Analysis failed'
      })
    }
  },

  setMode: (mode) => {
    const analysis = get().analysis
    const settings = get().settings
    set({
      mode,
      formatId: analysis
        ? preferredFormatId(analysis, mode, settings.defaultAudioFormat, settings.defaultVideoQuality)
        : get().formatId
    })
  },

  setFormatId: (formatId) => set({ formatId }),
  setImportToLibrary: (importToLibrary) => set({ importToLibrary }),
  setPlaylistId: (playlistId) => set({ playlistId }),

  start: async () => {
    const bridge = api()
    const { analysis, settings, playlistId, url } = get()
    const sourceUrl = (analysis?.sourceUrl ?? url).trim()
    if (!bridge) return 'Music API unavailable'
    if (!sourceUrl) return 'Paste a link first'
    const request: DownloadRequest & { analysis?: { title?: string; creator?: string; sourceType?: string } } = {
      sourceUrl,
      mode: 'audio',
      formatId: 'ba/bestaudio/best',
      outputExt: 'mp3',
      isConversion: true,
      destinationId: 'default',
      importToLibrary: true,
      ...(playlistId ? { playlistId } : {}),
      ...(analysis
        ? {
            analysis: {
              ...(analysis.title ? { title: analysis.title } : {}),
              ...(analysis.creator ? { creator: analysis.creator } : {}),
              sourceType: analysis.sourceType
            }
          }
        : {})
    }
    set({ starting: true })
    try {
      const result = await bridge.start(request)
      if (!result.ok) return result.error ?? 'Could not start download'
      if (result.job) {
        set({ jobs: [result.job, ...get().jobs.filter((job) => job.id !== result.job?.id)] })
      }
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not start download'
    } finally {
      set({ starting: false })
    }
  },

  downloadFromUrl: async (url) => {
    const next = (url ?? get().url).trim()
    if (!next) return 'Paste a link first'
    set({ url: next, analysis: null })
    return get().start()
  },

  cancel: async (jobId) => {
    await api()?.cancel(jobId)
    await get().refresh()
  },

  retry: async (jobId) => {
    await api()?.retry(jobId)
    await get().refresh()
  },

  deleteJob: async (jobId) => {
    const bridge = api()
    if (!bridge) return 'Music API unavailable'
    const job = get().jobs.find((item) => item.id === jobId)
    try {
      if (job?.trackId) {
        const { useMusicStore } = await import('@renderer/stores/music-store')
        const music = useMusicStore.getState()
        if (music.currentTrackId === job.trackId) {
          music.pause()
          useMusicStore.setState({ currentTrackId: null, status: 'idle', positionMs: 0, durationMs: 0 })
        }
      }
      const result = await bridge.delete(jobId)
      if (!result.ok) return result.error ?? 'Could not delete download'
      set({ jobs: get().jobs.filter((job) => job.id !== jobId) })
      void import('@renderer/stores/music-store').then(({ useMusicStore }) => {
        void useMusicStore.getState().refreshLibrary()
      })
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not delete download'
    }
  },

  clearHistory: async () => {
    await api()?.clearHistory()
    await get().refresh()
  },

  updateSettings: async (updates) => {
    const bridge = api()
    if (!bridge) return
    const settings = await bridge.updateSettings(updates)
    set({
      settings,
      ...(typeof updates.importAudioToLibrary === 'boolean'
        ? { importToLibrary: updates.importAudioToLibrary }
        : {})
    })
  },

  pickFolder: async () => {
    const folder = await api()?.pickFolder()
    if (folder) await get().refresh()
  },

  openFile: async (jobId) => {
    await api()?.openFile(jobId)
  },

  openFolder: async (jobId) => {
    await api()?.openFolder(jobId)
  },

  openDir: async () => {
    await api()?.openDir()
  },

  copyPath: async (jobId) => {
    const result = await api()?.copyPath(jobId)
    return result?.path ?? null
  },

  installEngine: async () => {
    const bridge = api()
    if (!bridge) return 'Music API unavailable'
    set({ installing: true, installError: null })
    try {
      const result = await bridge.installEngine()
      set({
        installing: false,
        engine: result.engine,
        installError: result.ok ? null : result.error ?? 'Install failed'
      })
      return result.ok ? null : result.error ?? 'Install failed'
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Install failed'
      set({ installing: false, installError: message })
      return message
    }
  }
}))

export function formatEta(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return ''
  const total = Math.max(0, Math.round(seconds))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

export function formatSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return ''
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

export function formatDurationSec(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function formatFilesize(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
