import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  type ReadDirectoryRequest,
  type ReadFileRequest,
  type SearchFilesRequest,
  type WriteFileRequest,
  FILESYSTEM_IPC
} from '@shared/contracts/filesystem'
import { listDirectory, readProjectFile, searchProjectFiles, writeProjectFile } from '../filesystem'
import { loadSnapshot } from '../persistence/database'

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (
    event.sender.isDestroyed() ||
    !BrowserWindow.fromWebContents(event.sender) ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error('Unauthorized filesystem request')
  }
}

function resolveProjectRoot(projectId: string): string {
  const project = loadSnapshot().projects.find((item) => item.id === projectId)
  if (!project?.folderPath) throw new Error('The requested project is not available')
  return project.folderPath
}

function validProjectId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200
}

function validateReadDirectory(payload: unknown): payload is ReadDirectoryRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as ReadDirectoryRequest
  return validProjectId(req.projectId) && typeof req.directoryPath === 'string' && req.directoryPath.length <= 4096
}

function validateSearchFiles(payload: unknown): payload is SearchFilesRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as SearchFilesRequest
  return validProjectId(req.projectId) && typeof req.query === 'string' && req.query.length <= 500
}

function validateReadFile(payload: unknown): payload is ReadFileRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as ReadFileRequest
  return validProjectId(req.projectId) && typeof req.filePath === 'string' && req.filePath.length <= 4096
}

function validateWriteFile(payload: unknown): payload is WriteFileRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as WriteFileRequest
  return (
    validProjectId(req.projectId) &&
    typeof req.filePath === 'string' &&
    req.filePath.length <= 4096 &&
    typeof req.content === 'string'
  )
}

export function registerFilesystemHandlers(): void {
  ipcMain.handle(FILESYSTEM_IPC.READ_DIRECTORY, async (event, payload: unknown) => {
    assertTrustedSender(event)
    if (!validateReadDirectory(payload)) {
      throw new Error('Invalid read directory request')
    }

    const entries = await listDirectory(resolveProjectRoot(payload.projectId), payload.directoryPath)
    return { entries }
  })

  ipcMain.handle(FILESYSTEM_IPC.READ_FILE, async (event, payload: unknown) => {
    assertTrustedSender(event)
    if (!validateReadFile(payload)) {
      throw new Error('Invalid read file request')
    }

    const content = await readProjectFile(resolveProjectRoot(payload.projectId), payload.filePath)
    return { content, path: payload.filePath }
  })

  ipcMain.handle(FILESYSTEM_IPC.WRITE_FILE, async (event, payload: unknown) => {
    assertTrustedSender(event)
    if (!validateWriteFile(payload)) {
      throw new Error('Invalid write file request')
    }

    const path = await writeProjectFile(resolveProjectRoot(payload.projectId), payload.filePath, payload.content)
    return { path }
  })

  ipcMain.handle(FILESYSTEM_IPC.SEARCH, async (event, payload: unknown) => {
    assertTrustedSender(event)
    if (!validateSearchFiles(payload)) {
      throw new Error('Invalid search files request')
    }

    const entries = await searchProjectFiles(resolveProjectRoot(payload.projectId), payload.query)
    return { entries }
  })
}
