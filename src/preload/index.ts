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
  developerIntelligence: developerIntelligenceApi
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window {
    api: AppApi
  }
}
