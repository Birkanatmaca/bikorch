export type FileEntryType = 'file' | 'directory'

export interface FileEntry {
  name: string
  path: string
  type: FileEntryType
}

export interface ReadDirectoryRequest {
  projectRoot: string
  directoryPath: string
}

export interface ReadDirectoryResponse {
  entries: FileEntry[]
}

export interface ReadFileRequest {
  projectRoot: string
  filePath: string
}

export interface ReadFileResponse {
  content: string
  path: string
}

export interface SearchFilesRequest {
  projectRoot: string
  query: string
}

export interface SearchFilesResponse {
  entries: FileEntry[]
}

export const FILESYSTEM_IPC = {
  READ_DIRECTORY: 'fs:readDirectory',
  READ_FILE: 'fs:readFile',
  SEARCH: 'fs:search'
} as const
