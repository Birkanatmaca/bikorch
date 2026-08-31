import { ipcMain } from 'electron'
import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import { USAGE_IPC, type CliUsageRequest } from '@shared/contracts/usage'
import { readCliUsage } from '../usage'

function isUsageRequest(payload: unknown): payload is CliUsageRequest {
  if (payload === undefined) return true
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false

  const request = payload as CliUsageRequest
  if (request.accounts === undefined) return true
  if (!Array.isArray(request.accounts) || request.accounts.length > 100) return false

  return request.accounts.every(
    (account) =>
      Boolean(account) &&
      AI_ACCOUNT_KINDS.includes(account.kind) &&
      typeof account.accountId === 'string' &&
      account.accountId.length > 0 &&
      account.accountId.length <= 200
  )
}

export function registerUsageHandlers(): void {
  ipcMain.handle(USAGE_IPC.READ, (_event, payload: unknown) => {
    if (!isUsageRequest(payload)) {
      throw new Error('Invalid usage request')
    }
    return readCliUsage(payload)
  })
}
