import { ipcMain } from 'electron'
import {
  type ReadDirectoryRequest,
  type ReadFileRequest,
  type SearchFilesRequest,
  FILESYSTEM_IPC
} from '@shared/contracts/filesystem'
import { listDirectory, readProjectFile, searchProjectFiles } from '../filesystem'

function validateReadDirectory(payload: unknown): payload is ReadDirectoryRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as ReadDirectoryRequest
  return typeof req.projectRoot === 'string' && typeof req.directoryPath === 'string'
}

function validateSearchFiles(payload: unknown): payload is SearchFilesRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as SearchFilesRequest
  return typeof req.projectRoot === 'string' && typeof req.query === 'string'
}

function validateReadFile(payload: unknown): payload is ReadFileRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as ReadFileRequest
  return typeof req.projectRoot === 'string' && typeof req.filePath === 'string'
}

export function registerFilesystemHandlers(): void {
  ipcMain.handle(FILESYSTEM_IPC.READ_DIRECTORY, async (_event, payload: unknown) => {
    if (!validateReadDirectory(payload)) {
      throw new Error('Invalid read directory request')
    }

    const entries = await listDirectory(payload.projectRoot, payload.directoryPath)
    return { entries }
  })

  ipcMain.handle(FILESYSTEM_IPC.READ_FILE, async (_event, payload: unknown) => {
    if (!validateReadFile(payload)) {
      throw new Error('Invalid read file request')
    }

    const content = await readProjectFile(payload.projectRoot, payload.filePath)
    return { content, path: payload.filePath }
  })

  ipcMain.handle(FILESYSTEM_IPC.SEARCH, async (_event, payload: unknown) => {
    if (!validateSearchFiles(payload)) {
      throw new Error('Invalid search files request')
    }

    const entries = await searchProjectFiles(payload.projectRoot, payload.query)
    return { entries }
  })
}
