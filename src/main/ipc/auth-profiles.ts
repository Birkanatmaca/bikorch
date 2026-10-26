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
  logoutAuthProfile,
  prepareAuthProfileLaunch,
  removeAuthProfile
} from '../accounts/profile-manager'
import { ptyManager } from '../cli/pty-manager'
import { withAntigravityCredentialLock } from '../accounts/credential-lock'
import { withCursorAccountLock } from '../accounts/cursor-profile'
import { assertTrustedMainWindow } from './trusted-sender'

function isAuthProfileRequest(payload: unknown): payload is AuthProfileRequest {
  if (!payload || typeof payload !== 'object') return false
  const request = payload as AuthProfileRequest
  return (
    typeof request.accountId === 'string' &&
    request.accountId.length > 0 &&
    request.accountId.length <= 200 &&
    AI_ACCOUNT_KINDS.includes(request.kind) &&
    (request.email === undefined ||
      (typeof request.email === 'string' && request.email.length <= 320)) &&
    (request.signedIn === undefined || typeof request.signedIn === 'boolean') &&
    (request.source === undefined || request.source === 'system' || request.source === 'profile')
  )
}

export function registerAuthProfileHandlers(): void {
  ipcMain.handle(AUTH_PROFILES_IPC.LIST, (event) => {
    assertTrustedMainWindow(event)
    return listAuthProfiles()
  })

  ipcMain.handle(AUTH_PROFILES_IPC.DISCOVER_SYSTEM, (event) => {
    assertTrustedMainWindow(event)
    return discoverSystemAuthProfiles()
  })

  ipcMain.handle(AUTH_PROFILES_IPC.IMPORT_CURRENT, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    if (payload.kind === 'antigravity') {
      return withAntigravityCredentialLock(() => importCurrentAuthProfile(payload))
    }
    if (payload.kind === 'cursor') {
      return withCursorAccountLock(payload.accountId, () => importCurrentAuthProfile(payload))
    }
    return importCurrentAuthProfile(payload)
  })

  ipcMain.handle(AUTH_PROFILES_IPC.ACTIVATE, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    if (payload.kind === 'antigravity') {
      return withAntigravityCredentialLock(() => prepareAuthProfileLaunch(payload, 'normal'))
    }
    if (payload.kind === 'cursor') {
      return withCursorAccountLock(payload.accountId, () => prepareAuthProfileLaunch(payload, 'normal'))
    }
    return prepareAuthProfileLaunch(payload, 'normal')
  })

  ipcMain.handle(AUTH_PROFILES_IPC.INSPECT, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    return inspectAuthProfile(payload)
  })

  ipcMain.handle(AUTH_PROFILES_IPC.LOGOUT, async (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    const logout = async () => {
      ptyManager.killForAccount(payload.kind, payload.accountId)
      return logoutAuthProfile(payload)
    }
    if (payload.kind === 'cursor') return withCursorAccountLock(payload.accountId, logout)
    if (payload.kind === 'antigravity') return withAntigravityCredentialLock(logout)
    return logout()
  })

  ipcMain.handle(AUTH_PROFILES_IPC.REMOVE, async (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    if (!isAuthProfileRequest(payload)) {
      return { ok: false, ready: false, error: 'Invalid account profile request' }
    }
    const remove = async () => {
      ptyManager.killForAccount(payload.kind, payload.accountId)
      return removeAuthProfile(payload)
    }
    if (payload.kind === 'cursor') return withCursorAccountLock(payload.accountId, remove)
    if (payload.kind === 'antigravity') return withAntigravityCredentialLock(remove)
    return remove()
  })
}
