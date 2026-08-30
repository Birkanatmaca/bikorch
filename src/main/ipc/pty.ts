import { ipcMain } from 'electron'
import {
  type PtyCreateRequest,
  type PtyKillRequest,
  type PtyResizeRequest,
  type PtyWriteRequest,
  PTY_IPC
} from '@shared/contracts/pty'
import { isValidSessionId } from '../cli/path-validator'
import { ptyManager } from '../cli/pty-manager'

function validateWriteRequest(payload: unknown): payload is PtyWriteRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as PtyWriteRequest
  return isValidSessionId(req.sessionId) && typeof req.data === 'string'
}

function validateResizeRequest(payload: unknown): payload is PtyResizeRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as PtyResizeRequest
  return (
    isValidSessionId(req.sessionId) &&
    typeof req.cols === 'number' &&
    typeof req.rows === 'number' &&
    req.cols > 0 &&
    req.rows > 0
  )
}

function validateKillRequest(payload: unknown): payload is PtyKillRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as PtyKillRequest
  return isValidSessionId(req.sessionId)
}

function validateCreateRequest(payload: unknown): payload is PtyCreateRequest {
  if (!payload || typeof payload !== 'object') return false
  const req = payload as PtyCreateRequest
  return (
    isValidSessionId(req.sessionId) &&
    typeof req.cwd === 'string' &&
    (req.launchMode === undefined || req.launchMode === 'normal' || req.launchMode === 'login') &&
    (req.accountId === undefined ||
      (typeof req.accountId === 'string' && req.accountId.length > 0 && req.accountId.length <= 200)) &&
    (
      req.kind === 'terminal' ||
      req.kind === 'claude' ||
      req.kind === 'cursor' ||
      req.kind === 'gemini' ||
      req.kind === 'antigravity' ||
      req.kind === 'codex'
    )
  )
}

export function registerPtyHandlers(): void {
  ipcMain.handle(PTY_IPC.CREATE, (event, payload: unknown) => {
    if (!validateCreateRequest(payload)) {
      return { sessionId: '', status: 'error' as const, error: 'Invalid create request' }
    }
    return ptyManager.create(payload, event.sender)
  })

  ipcMain.handle(PTY_IPC.WRITE, (_event, payload: unknown) => {
    if (!validateWriteRequest(payload)) return
    ptyManager.write(payload.sessionId, payload.data)
  })

  ipcMain.handle(PTY_IPC.RESIZE, (_event, payload: unknown) => {
    if (!validateResizeRequest(payload)) return
    ptyManager.resize(payload.sessionId, payload.cols, payload.rows)
  })

  ipcMain.handle(PTY_IPC.KILL, (_event, payload: unknown) => {
    if (!validateKillRequest(payload)) return
    ptyManager.kill(payload.sessionId)
  })
}
