import { ipcMain } from 'electron'
import {
  AUTH_PROFILES_IPC,
  type AuthProfileRequest
} from '@shared/contracts/auth-profiles'
import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import {
  importCurrentAuthProfile,
  inspectAuthProfile,
  listAuthProfiles,
  prepareAuthProfileLaunch,
  removeAuthProfile
} from '../accounts/profile-manager'

function isAuthProfileRequest(payload: unknown): payload is AuthProfileRequest {
  if (!payload || typeof payload !== 'object') return false
  const request = payload as AuthProfileRequest
  return (
    typeof request.accountId === 'string' &&
    request.accountId.length > 0 &&
    request.accountId.length <= 200 &&
    AI_ACCOUNT_KINDS.includes(request.kind) &&
    (request.email === undefined ||
      (typeof request.email === 'string' && request.email.length <= 320))
  )
}

export function registerAuthProfileHandlers(): void {
  ipcMain.handle(AUTH_PROFILES_IPC.LIST, () => listAuthProfiles())

  ipcMain.handle(AUTH_PROFILES_IPC.IMPORT_CURRENT, (_event, payload: unknown) => {
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    return importCurrentAuthProfile(payload)
  })

  ipcMain.handle(AUTH_PROFILES_IPC.ACTIVATE, (_event, payload: unknown) => {
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    return prepareAuthProfileLaunch(payload, 'normal')
  })

  ipcMain.handle(AUTH_PROFILES_IPC.INSPECT, (_event, payload: unknown) => {
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    return inspectAuthProfile(payload)
  })

  ipcMain.handle(AUTH_PROFILES_IPC.REMOVE, (_event, payload: unknown) => {
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    return removeAuthProfile(payload)
  })
}
