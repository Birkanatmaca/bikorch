import { ipcMain } from 'electron'
import { LOGS_IPC, type GetLogsRequest } from '@shared/contracts/logs'
import { clearLogs, getLogs } from '../logs'

function validateGetLogsRequest(payload: unknown): payload is GetLogsRequest {
  if (payload === undefined) return true
  if (!payload || typeof payload !== 'object') return false

  const request = payload as GetLogsRequest
  return request.limit === undefined || (typeof request.limit === 'number' && Number.isFinite(request.limit))
}

export function registerLogsHandlers(): void {
  ipcMain.handle(LOGS_IPC.GET, (_event, payload: unknown) => {
    if (!validateGetLogsRequest(payload)) throw new Error('Invalid logs request')
    return { entries: getLogs(payload?.limit) }
  })

  ipcMain.handle(LOGS_IPC.CLEAR, () => {
    clearLogs()
    return { ok: true }
  })
}
