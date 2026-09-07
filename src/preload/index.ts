import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  type ReadDirectoryRequest,
  type ReadDirectoryResponse,
  type ReadFileRequest,
  type ReadFileResponse,
  type SearchFilesRequest,
  type SearchFilesResponse,
  FILESYSTEM_IPC
} from '@shared/contracts/filesystem'
import {
  type GitDiffRequest,
  type GitDiffResponse,
  type GitCheckoutBranchRequest,
  type GitDiscardRequest,
  type GitFileRequest,
  type GitCommitRequest,
  type GitDiscoverRequest,
  type GitDiscoverResponse,
  type GitStatusRequest,
  type GitStatusResponse,
  GIT_IPC
} from '@shared/contracts/git'
import {
  type PersistedSnapshot,
  PERSISTENCE_IPC
} from '@shared/contracts/persistence'
import {
  type PtyCreateRequest,
  type PtyCreateResponse,
  type PtyEvent,
  type PtyKillRequest,
  type PtyResizeRequest,
  type PtyWriteRequest,
  PTY_IPC,
  CLI_IPC,
  type PtyKind
} from '@shared/contracts/pty'
import {
  type CliUsageRequest,
  type CliUsageResponse,
  USAGE_IPC
} from '@shared/contracts/usage'
import {
  LOGS_IPC,
  type AppLogEntry,
  type GetLogsRequest,
  type LogEvent
} from '@shared/contracts/logs'
import { WINDOW_IPC } from '@shared/contracts/window'
import {
  AUTH_PROFILES_IPC,
  type AuthProfileRequest,
  type AuthProfileResult,
  type AuthProfileSummary,
  type SystemAuthDiscovery
} from '@shared/contracts/auth-profiles'
import {
  DEVELOPER_INTELLIGENCE_IPC,
  type AnalyzeMemoriesResult,
  type ClearTarget,
  type DeveloperEventInput,
  type DeveloperIntelligenceExportResult,
  type DeveloperIntelligenceSettings,
  type DeveloperIntelligenceStats,
  type DeveloperMemory,
  type DeveloperMetrics,
  type MemoryContextPackage,
  type MemoryContextRequest,
  type MemoryDraft,
  type MemoryUpdate,
  type MetricsRequest,
  type PromptHistoryFilter,
  type PromptHistoryPage,
  type RecordPromptRequest,
  type RecordPromptResponse
} from '@shared/contracts/developer-intelligence'
import {
  MUSIC_IPC,
  type AddLinkResult,
  type CreatePlaylistRequest,
  type ImportTracksRequest,
  type ImportTracksResult,
  type MusicLibrarySummary,
  type MusicPlaybackSnapshot,
  type MusicPlaylist,
  type MusicSettings,
  type MusicStorageMode,
  type MusicTrack,
  type RecordPlayRequest,
  type RenamePlaylistRequest,
  type SpotifyAccessTokenResponse,
  type SpotifyCatalogTrack,
  type SpotifyConnectionStatus,
  type SpotifyTimeRange
} from '@shared/contracts/music'
import {
  MUSIC_DOWNLOAD_IPC,
  type AnalyzeResult,
  type DownloadEngineStatus,
  type EngineInstallResult,
  type DownloadEvent,
  type DownloadJob,
  type DownloadRequest,
  type DownloadSettings,
  type StartDownloadResult
} from '@shared/contracts/downloads'

export interface MusicApi {
  library: {
    list: () => Promise<MusicTrack[]>
    importFiles: (mode?: MusicStorageMode) => Promise<ImportTracksResult & { canceled?: boolean }>
    importFolder: (mode?: MusicStorageMode) => Promise<ImportTracksResult & { canceled?: boolean }>
    importPaths: (request: ImportTracksRequest) => Promise<ImportTracksResult>
    remove: (trackId: string) => Promise<{ ok: boolean }>
    updateDuration: (trackId: string, durationMs: number) => Promise<{ ok: boolean }>
    summary: () => Promise<MusicLibrarySummary>
    search: (query: string) => Promise<MusicTrack[]>
  }
  favorites: {
    list: () => Promise<MusicTrack[]>
    toggle: (trackId: string) => Promise<{ favorited: boolean }>
  }
  history: {
    list: () => Promise<unknown[]>
    recordPlay: (request: RecordPlayRequest) => Promise<{ historyId: string | null }>
    recordListen: (historyId: string, listenedMs: number) => Promise<{ ok: true }>
  }
  playlists: {
    list: () => Promise<MusicPlaylist[]>
    create: (request: CreatePlaylistRequest) => Promise<MusicPlaylist | null>
    rename: (request: RenamePlaylistRequest) => Promise<{ ok: boolean }>
    delete: (playlistId: string) => Promise<{ ok: boolean }>
    addTracks: (playlistId: string, trackIds: string[]) => Promise<{ ok: true }>
    removeTrack: (playlistId: string, trackId: string) => Promise<{ ok: true }>
    reorder: (playlistId: string, trackIds: string[]) => Promise<{ ok: true }>
    getTracks: (playlistId: string) => Promise<MusicTrack[]>
  }
  queue: {
    get: () => Promise<string[]>
    set: (trackIds: string[]) => Promise<{ ok: true }>
    add: (trackIds: string[]) => Promise<{ ok: true }>
    remove: (trackId: string) => Promise<{ ok: true }>
    clear: () => Promise<{ ok: true }>
    reorder: (trackIds: string[]) => Promise<{ ok: true }>
  }
  getSettings: () => Promise<MusicSettings>
  updateSettings: (updates: Partial<MusicSettings>) => Promise<MusicSettings>
  getPlayback: () => Promise<MusicPlaybackSnapshot | null>
  savePlayback: (snapshot: MusicPlaybackSnapshot) => Promise<{ ok: true }>
  checkTrack: (trackId: string) => Promise<{ ok: boolean; reason?: string }>
  ensurePlayable: (
    trackId: string,
    force?: boolean
  ) => Promise<{ ok: true; converted: boolean; filePath: string } | { ok: false; error: string }>
  readPlayback: (
    trackId: string
  ) => Promise<{ ok: true; mime: string; data: Uint8Array } | { ok: false; error: string }>
  recentlyPlayed: () => Promise<MusicTrack[]>
  addLink: (url: string) => Promise<AddLinkResult>
  openExternal: (url: string) => Promise<{ ok: true }>
  spotify: {
    status: () => Promise<SpotifyConnectionStatus>
    setClientId: (clientId: string) => Promise<SpotifyConnectionStatus>
    connect: () => Promise<{ ok: true } | { ok: false; error: string }>
    disconnect: () => Promise<{ ok: true }>
    accessToken: () => Promise<SpotifyAccessTokenResponse>
    topTracks: (request?: {
      timeRange?: SpotifyTimeRange
      limit?: number
    }) => Promise<SpotifyCatalogTrack[]>
    importTop: (request?: {
      timeRange?: SpotifyTimeRange
      limit?: number
    }) => Promise<{ imported: number; skipped: number; tracks: MusicTrack[] }>
    importOne: (
      sourceId: string
    ) => Promise<{ ok: true; track: MusicTrack; duplicate: boolean } | { ok: false; error: string }>
    resolvePlayback: (request: {
      title: string
      artist?: string
      sourceId?: string
    }) => Promise<{ ok: true; videoId: string; title?: string } | { ok: false; error: string }>
  }
  downloads: {
    engineStatus: () => Promise<DownloadEngineStatus>
    installEngine: () => Promise<EngineInstallResult>
    analyze: (url: string) => Promise<AnalyzeResult>
    start: (request: DownloadRequest & { analysis?: { title?: string; creator?: string; sourceType?: string } }) => Promise<StartDownloadResult>
    list: () => Promise<DownloadJob[]>
    cancel: (jobId: string) => Promise<{ ok: boolean }>
    retry: (jobId: string) => Promise<{ ok: boolean; error?: string }>
    delete: (jobId: string) => Promise<{ ok: boolean; error?: string }>
    clearHistory: () => Promise<{ ok: true; removed: number }>
    getSettings: () => Promise<DownloadSettings>
    updateSettings: (updates: Partial<DownloadSettings>) => Promise<DownloadSettings>
    pickFolder: () => Promise<string | null>
    openFile: (jobId: string) => Promise<{ ok: boolean; error?: string }>
    openFolder: (jobId: string) => Promise<{ ok: boolean; error?: string }>
    openDir: () => Promise<{ ok: boolean; error?: string }>
    copyPath: (jobId: string) => Promise<{ ok: boolean; path?: string; error?: string }>
    onEvent: (callback: (event: DownloadEvent) => void) => () => void
  }
}

export interface CliApi {
  detect: (kind: Exclude<PtyKind, 'terminal'>) => Promise<{
    installed: boolean
    command: string | null
  }>
  install: (kind: Exclude<PtyKind, 'terminal'>) => Promise<{ ok: boolean; error?: string }>
}

export interface PtyApi {
  create: (request: PtyCreateRequest) => Promise<PtyCreateResponse>
  write: (request: PtyWriteRequest) => Promise<void>
  resize: (request: PtyResizeRequest) => Promise<void>
  kill: (request: PtyKillRequest) => Promise<void>
  onEvent: (callback: (event: PtyEvent) => void) => () => void
}

export interface FilesystemApi {
  readDirectory: (request: ReadDirectoryRequest) => Promise<ReadDirectoryResponse>
  readFile: (request: ReadFileRequest) => Promise<ReadFileResponse>
  search: (request: SearchFilesRequest) => Promise<SearchFilesResponse>
}

export interface GitApi {
  discover: (request: GitDiscoverRequest) => Promise<GitDiscoverResponse>
  status: (request: GitStatusRequest) => Promise<GitStatusResponse>
  checkoutBranch: (request: GitCheckoutBranchRequest) => Promise<{ ok: true }>
  diff: (request: GitDiffRequest) => Promise<GitDiffResponse>
  discard: (request: GitDiscardRequest) => Promise<{ ok: true }>
  stage: (request: GitFileRequest) => Promise<{ ok: true }>
  unstage: (request: GitFileRequest) => Promise<{ ok: true }>
  stageAll: (request: GitStatusRequest) => Promise<{ ok: true }>
  unstageAll: (request: GitStatusRequest) => Promise<{ ok: true }>
  commit: (request: GitCommitRequest) => Promise<{ ok: true }>
}

export interface PersistenceApi {
  load: () => Promise<PersistedSnapshot>
  save: (snapshot: PersistedSnapshot) => Promise<void>
}

export interface WindowApi {
  minimize: () => Promise<void>
  maximize: () => Promise<boolean>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
}

export interface UsageApi {
  read: (request?: CliUsageRequest) => Promise<CliUsageResponse>
}

export interface LogsApi {
  get: (request?: GetLogsRequest) => Promise<{ entries: AppLogEntry[] }>
  clear: () => Promise<{ ok: true }>
  onEvent: (callback: (event: LogEvent) => void) => () => void
}

export interface AuthProfilesApi {
  list: () => Promise<AuthProfileSummary[]>
  discoverSystem: () => Promise<SystemAuthDiscovery[]>
  importCurrent: (request: AuthProfileRequest) => Promise<AuthProfileResult>
  activate: (request: AuthProfileRequest) => Promise<AuthProfileResult>
  inspect: (request: AuthProfileRequest) => Promise<AuthProfileResult>
  remove: (request: AuthProfileRequest) => Promise<AuthProfileResult>
}

export interface DeveloperIntelligenceApi {
  recordEvent: (event: DeveloperEventInput) => Promise<{ ok: true; id: string | null }>
  recordPrompt: (request: RecordPromptRequest) => Promise<RecordPromptResponse>
  listPrompts: (filter?: PromptHistoryFilter) => Promise<PromptHistoryPage>
  deletePrompts: (ids: string[] | 'all') => Promise<{ removed: number }>
  getMetrics: (request: MetricsRequest) => Promise<DeveloperMetrics>
  listMemories: () => Promise<DeveloperMemory[]>
  createMemory: (draft: MemoryDraft) => Promise<DeveloperMemory | null>
  updateMemory: (id: string, updates: MemoryUpdate) => Promise<DeveloperMemory | null>
  deleteMemory: (id: string) => Promise<{ ok: boolean }>
  getSettings: () => Promise<DeveloperIntelligenceSettings>
  updateSettings: (
    updates: Partial<DeveloperIntelligenceSettings>
  ) => Promise<DeveloperIntelligenceSettings>
  getStats: () => Promise<DeveloperIntelligenceStats>
  exportData: () => Promise<DeveloperIntelligenceExportResult>
  clear: (target: ClearTarget) => Promise<{ ok: true }>
  analyzeMemories: (request: MetricsRequest) => Promise<AnalyzeMemoriesResult>
  getContext: (request?: MemoryContextRequest) => Promise<MemoryContextPackage>
}

export interface AppApi {
  platform: NodeJS.Platform
  selectFolder: () => Promise<string | null>
  pty: PtyApi
  cli: CliApi
  fs: FilesystemApi
  git: GitApi
  persistence: PersistenceApi
  usage: UsageApi
  logs: LogsApi
  authProfiles: AuthProfilesApi
  window: WindowApi
  developerIntelligence: DeveloperIntelligenceApi
  music: MusicApi
}

const ptyApi: PtyApi = {
  create: (request) => ipcRenderer.invoke(PTY_IPC.CREATE, request),
  write: (request) => ipcRenderer.invoke(PTY_IPC.WRITE, request),
  resize: (request) => ipcRenderer.invoke(PTY_IPC.RESIZE, request),
  kill: (request) => ipcRenderer.invoke(PTY_IPC.KILL, request),
  onEvent: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: PtyEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(PTY_IPC.EVENT, listener)
    return () => {
      ipcRenderer.removeListener(PTY_IPC.EVENT, listener)
    }
  }
}

const cliApi: CliApi = {
  detect: (kind) => ipcRenderer.invoke(CLI_IPC.DETECT, kind),
  install: (kind) => ipcRenderer.invoke(CLI_IPC.INSTALL, kind)
}

const fsApi: FilesystemApi = {
  readDirectory: (request) => ipcRenderer.invoke(FILESYSTEM_IPC.READ_DIRECTORY, request),
  readFile: (request) => ipcRenderer.invoke(FILESYSTEM_IPC.READ_FILE, request),
  search: (request) => ipcRenderer.invoke(FILESYSTEM_IPC.SEARCH, request)
}

const gitApi: GitApi = {
  discover: (request) => ipcRenderer.invoke(GIT_IPC.DISCOVER, request),
  status: (request) => ipcRenderer.invoke(GIT_IPC.STATUS, request),
  checkoutBranch: (request) => ipcRenderer.invoke(GIT_IPC.CHECKOUT_BRANCH, request),
  diff: (request) => ipcRenderer.invoke(GIT_IPC.DIFF, request),
  discard: (request) => ipcRenderer.invoke(GIT_IPC.DISCARD, request),
  stage: (request) => ipcRenderer.invoke(GIT_IPC.STAGE, request),
  unstage: (request) => ipcRenderer.invoke(GIT_IPC.UNSTAGE, request),
  stageAll: (request) => ipcRenderer.invoke(GIT_IPC.STAGE_ALL, request),
  unstageAll: (request) => ipcRenderer.invoke(GIT_IPC.UNSTAGE_ALL, request),
  commit: (request) => ipcRenderer.invoke(GIT_IPC.COMMIT, request)
}

const persistenceApi: PersistenceApi = {
  load: () => ipcRenderer.invoke(PERSISTENCE_IPC.LOAD),
  save: (snapshot) => ipcRenderer.invoke(PERSISTENCE_IPC.SAVE, snapshot)
}

const usageApi: UsageApi = {
  read: (request) => ipcRenderer.invoke(USAGE_IPC.READ, request)
}

const logsApi: LogsApi = {
  get: (request) => ipcRenderer.invoke(LOGS_IPC.GET, request),
  clear: () => ipcRenderer.invoke(LOGS_IPC.CLEAR),
  onEvent: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: LogEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(LOGS_IPC.EVENT, listener)
    return () => {
      ipcRenderer.removeListener(LOGS_IPC.EVENT, listener)
    }
  }
}

const authProfilesApi: AuthProfilesApi = {
  list: () => ipcRenderer.invoke(AUTH_PROFILES_IPC.LIST),
  discoverSystem: () => ipcRenderer.invoke(AUTH_PROFILES_IPC.DISCOVER_SYSTEM),
  importCurrent: (request) => ipcRenderer.invoke(AUTH_PROFILES_IPC.IMPORT_CURRENT, request),
  activate: (request) => ipcRenderer.invoke(AUTH_PROFILES_IPC.ACTIVATE, request),
  inspect: (request) => ipcRenderer.invoke(AUTH_PROFILES_IPC.INSPECT, request),
  remove: (request) => ipcRenderer.invoke(AUTH_PROFILES_IPC.REMOVE, request)
}

const windowApi: WindowApi = {
  minimize: () => ipcRenderer.invoke(WINDOW_IPC.MINIMIZE),
  maximize: () => ipcRenderer.invoke(WINDOW_IPC.MAXIMIZE),
  close: () => ipcRenderer.invoke(WINDOW_IPC.CLOSE),
  isMaximized: () => ipcRenderer.invoke(WINDOW_IPC.IS_MAXIMIZED)
}

const developerIntelligenceApi: DeveloperIntelligenceApi = {
  recordEvent: (event) => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.RECORD_EVENT, event),
  recordPrompt: (request) => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.RECORD_PROMPT, request),
  listPrompts: (filter) => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.LIST_PROMPTS, filter ?? {}),
  deletePrompts: (ids) => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.DELETE_PROMPTS, ids),
  getMetrics: (request) => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.GET_METRICS, request),
  listMemories: () => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.LIST_MEMORIES),
  createMemory: (draft) => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.CREATE_MEMORY, draft),
  updateMemory: (id, updates) =>
    ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.UPDATE_MEMORY, { id, updates }),
  deleteMemory: (id) => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.DELETE_MEMORY, id),
  getSettings: () => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.GET_SETTINGS),
  updateSettings: (updates) => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.UPDATE_SETTINGS, updates),
  getStats: () => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.GET_STATS),
  exportData: () => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.EXPORT),
  clear: (target) => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.CLEAR, target),
  analyzeMemories: (request) => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.ANALYZE, request),
  getContext: (request) => ipcRenderer.invoke(DEVELOPER_INTELLIGENCE_IPC.GET_CONTEXT, request ?? {})
}

const musicApi: MusicApi = {
  library: {
    list: () => ipcRenderer.invoke(MUSIC_IPC.LIBRARY_LIST),
    importFiles: (mode) => ipcRenderer.invoke(MUSIC_IPC.LIBRARY_IMPORT_FILES, mode ?? null),
    importFolder: (mode) => ipcRenderer.invoke(MUSIC_IPC.LIBRARY_IMPORT_FOLDER, mode ?? null),
    importPaths: (request) => ipcRenderer.invoke(MUSIC_IPC.LIBRARY_IMPORT_PATHS, request),
    remove: (trackId) => ipcRenderer.invoke(MUSIC_IPC.LIBRARY_REMOVE, trackId),
    updateDuration: (trackId, durationMs) =>
      ipcRenderer.invoke(MUSIC_IPC.LIBRARY_UPDATE_DURATION, { trackId, durationMs }),
    summary: () => ipcRenderer.invoke(MUSIC_IPC.LIBRARY_SUMMARY),
    search: (query) => ipcRenderer.invoke(MUSIC_IPC.SEARCH, query)
  },
  favorites: {
    list: () => ipcRenderer.invoke(MUSIC_IPC.FAVORITES_LIST),
    toggle: (trackId) => ipcRenderer.invoke(MUSIC_IPC.FAVORITES_TOGGLE, trackId)
  },
  history: {
    list: () => ipcRenderer.invoke(MUSIC_IPC.HISTORY_LIST),
    recordPlay: (request) => ipcRenderer.invoke(MUSIC_IPC.HISTORY_RECORD_PLAY, request),
    recordListen: (historyId, listenedMs) =>
      ipcRenderer.invoke(MUSIC_IPC.HISTORY_RECORD_LISTEN, { historyId, listenedMs })
  },
  playlists: {
    list: () => ipcRenderer.invoke(MUSIC_IPC.PLAYLISTS_LIST),
    create: (request) => ipcRenderer.invoke(MUSIC_IPC.PLAYLISTS_CREATE, request),
    rename: (request) => ipcRenderer.invoke(MUSIC_IPC.PLAYLISTS_RENAME, request),
    delete: (playlistId) => ipcRenderer.invoke(MUSIC_IPC.PLAYLISTS_DELETE, playlistId),
    addTracks: (playlistId, trackIds) =>
      ipcRenderer.invoke(MUSIC_IPC.PLAYLISTS_ADD_TRACKS, { playlistId, trackIds }),
    removeTrack: (playlistId, trackId) =>
      ipcRenderer.invoke(MUSIC_IPC.PLAYLISTS_REMOVE_TRACK, { playlistId, trackId }),
    reorder: (playlistId, trackIds) =>
      ipcRenderer.invoke(MUSIC_IPC.PLAYLISTS_REORDER, { playlistId, trackIds }),
    getTracks: (playlistId) => ipcRenderer.invoke(MUSIC_IPC.PLAYLISTS_GET_TRACKS, playlistId)
  },
  queue: {
    get: () => ipcRenderer.invoke(MUSIC_IPC.QUEUE_GET),
    set: (trackIds) => ipcRenderer.invoke(MUSIC_IPC.QUEUE_SET, { trackIds }),
    add: (trackIds) => ipcRenderer.invoke(MUSIC_IPC.QUEUE_ADD, { trackIds }),
    remove: (trackId) => ipcRenderer.invoke(MUSIC_IPC.QUEUE_REMOVE, trackId),
    clear: () => ipcRenderer.invoke(MUSIC_IPC.QUEUE_CLEAR),
    reorder: (trackIds) => ipcRenderer.invoke(MUSIC_IPC.QUEUE_REORDER, { trackIds })
  },
  getSettings: () => ipcRenderer.invoke(MUSIC_IPC.GET_SETTINGS),
  updateSettings: (updates) => ipcRenderer.invoke(MUSIC_IPC.UPDATE_SETTINGS, updates),
  getPlayback: () => ipcRenderer.invoke(MUSIC_IPC.GET_PLAYBACK),
  savePlayback: (snapshot) => ipcRenderer.invoke(MUSIC_IPC.SAVE_PLAYBACK, snapshot),
  checkTrack: (trackId) => ipcRenderer.invoke(MUSIC_IPC.CHECK_TRACK, trackId),
  ensurePlayable: (trackId, force) =>
    ipcRenderer.invoke(MUSIC_IPC.ENSURE_PLAYABLE, { trackId, force: force === true }),
  readPlayback: (trackId) => ipcRenderer.invoke(MUSIC_IPC.LIBRARY_READ_PLAYBACK, trackId),
  recentlyPlayed: () => ipcRenderer.invoke('music:recently-played'),
  addLink: (url) => ipcRenderer.invoke(MUSIC_IPC.ADD_LINK, url),
  openExternal: (url) => ipcRenderer.invoke(MUSIC_IPC.OPEN_EXTERNAL, url),
  spotify: {
    status: () => ipcRenderer.invoke(MUSIC_IPC.SPOTIFY_STATUS),
    setClientId: (clientId) => ipcRenderer.invoke(MUSIC_IPC.SPOTIFY_SET_CLIENT_ID, clientId),
    connect: () => ipcRenderer.invoke(MUSIC_IPC.SPOTIFY_CONNECT),
    disconnect: () => ipcRenderer.invoke(MUSIC_IPC.SPOTIFY_DISCONNECT),
    accessToken: () => ipcRenderer.invoke(MUSIC_IPC.SPOTIFY_ACCESS_TOKEN),
    topTracks: (request) => ipcRenderer.invoke(MUSIC_IPC.SPOTIFY_TOP_TRACKS, request ?? {}),
    importTop: (request) => ipcRenderer.invoke(MUSIC_IPC.SPOTIFY_IMPORT_TOP, request ?? {}),
    importOne: (sourceId) => ipcRenderer.invoke(MUSIC_IPC.SPOTIFY_IMPORT_ONE, { sourceId }),
    resolvePlayback: (request) => ipcRenderer.invoke(MUSIC_IPC.SPOTIFY_RESOLVE_PLAYBACK, request)
  },
  downloads: {
    engineStatus: () => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.ENGINE_STATUS),
    installEngine: () => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.ENGINE_INSTALL),
    analyze: (url) => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.ANALYZE, url),
    start: (request) => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.START, request),
    list: () => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.LIST),
    cancel: (jobId) => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.CANCEL, jobId),
    retry: (jobId) => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.RETRY, jobId),
    delete: (jobId) => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.DELETE, jobId),
    clearHistory: () => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.CLEAR_HISTORY),
    getSettings: () => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.GET_SETTINGS),
    updateSettings: (updates) => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.UPDATE_SETTINGS, updates),
    pickFolder: () => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.PICK_FOLDER),
    openFile: (jobId) => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.OPEN_FILE, jobId),
    openFolder: (jobId) => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.OPEN_FOLDER, jobId),
    openDir: () => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.OPEN_DIR),
    copyPath: (jobId) => ipcRenderer.invoke(MUSIC_DOWNLOAD_IPC.COPY_PATH, jobId),
    onEvent: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: DownloadEvent): void => {
        callback(payload)
      }
      ipcRenderer.on(MUSIC_DOWNLOAD_IPC.EVENT, listener)
      return () => {
        ipcRenderer.removeListener(MUSIC_DOWNLOAD_IPC.EVENT, listener)
      }
    }
  }
}

const api: AppApi = {
  platform: process.platform,
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  pty: ptyApi,
  cli: cliApi,
  fs: fsApi,
  git: gitApi,
  persistence: persistenceApi,
  usage: usageApi,
  logs: logsApi,
  authProfiles: authProfilesApi,
  window: windowApi,
  developerIntelligence: developerIntelligenceApi,
  music: musicApi
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window {
    api: AppApi
  }
}
