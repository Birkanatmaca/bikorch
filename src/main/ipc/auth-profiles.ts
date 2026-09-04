import { ipcMain } from 'electron'
import {
  AUTH_PROFILES_IPC,
  type AuthProfileRequest
} from '@shared/contracts/auth-profiles'
import { AI_ACCOUNT_KINDS } from '@shared/contracts/accounts'
import {
  importCurrentAuthProfile,
  inspectAuthProfile,
  discoverSystemAuthProfiles,
  listAuthProfiles,
  prepareAuthProfileLaunch,
  removeAuthProfile
} from '../accounts/profile-manager'
import { ptyManager } from '../cli/pty-manager'
import { withAntigravityCredentialLock } from '../accounts/credential-lock'

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

  ipcMain.handle(AUTH_PROFILES_IPC.DISCOVER_SYSTEM, () => discoverSystemAuthProfiles())

  ipcMain.handle(AUTH_PROFILES_IPC.IMPORT_CURRENT, (_event, payload: unknown) => {
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    if (payload.kind === 'antigravity') {
      return withAntigravityCredentialLock(() => importCurrentAuthProfile(payload))
    }
    return importCurrentAuthProfile(payload)
  })

  ipcMain.handle(AUTH_PROFILES_IPC.ACTIVATE, (_event, payload: unknown) => {
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    if (payload.kind === 'antigravity') {
      return withAntigravityCredentialLock(() => prepareAuthProfileLaunch(payload, 'normal'))
    }
    return prepareAuthProfileLaunch(payload, 'normal')
  })

  ipcMain.handle(AUTH_PROFILES_IPC.INSPECT, (_event, payload: unknown) => {
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    return inspectAuthProfile(payload)
  })

  ipcMain.handle(AUTH_PROFILES_IPC.REMOVE, async (_event, payload: unknown) => {
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    ptyManager.killForAccount(payload.kind, payload.accountId)
    return await removeAuthProfile(payload)
  })
}
