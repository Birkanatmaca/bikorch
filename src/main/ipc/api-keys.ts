import { ipcMain } from 'electron'
import {
  API_KEYS_IPC,
  API_KEY_PROVIDER_CLI,
  type ApiKeyAddRequest,
  type ApiKeyResult
} from '@shared/contracts/api-keys'
import {
  addApiKey,
  findApiKey,
  listApiKeys,
  removeApiKey,
  renameApiKey,
  setManagerApiKey,
  testApiKey
} from '../api-keys/vault'
import { connectApiKeyProfile } from '../accounts/profile-manager'
import { ptyManager } from '../cli/pty-manager'
import { assertTrustedMainWindow } from './trusted-sender'

function isKeyId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value)
}

function result(action: () => void): ApiKeyResult {
  try {
    action()
    return { ok: true, keys: listApiKeys() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not update API keys', keys: listApiKeys() }
  }
}

export function registerApiKeyHandlers(): void {
  ipcMain.handle(API_KEYS_IPC.LIST, (event) => {
    assertTrustedMainWindow(event)
    return listApiKeys()
  })

  ipcMain.handle(API_KEYS_IPC.ADD, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const request = payload as Partial<ApiKeyAddRequest> | null
    return result(() => {
      if (!request || typeof request.secret !== 'string' || typeof request.label !== 'string') {
        throw new Error('Enter a name and an API key')
      }
      addApiKey({
        provider: request.provider as ApiKeyAddRequest['provider'],
        label: request.label,
        secret: request.secret,
        useForManager: request.useForManager === true
      })
    })
  })

  ipcMain.handle(API_KEYS_IPC.REMOVE, (event, id: unknown) => {
    assertTrustedMainWindow(event)
    return result(() => {
      if (!isKeyId(id)) throw new Error('Invalid API key')
      removeApiKey(id)
    })
  })

  ipcMain.handle(API_KEYS_IPC.RENAME, (event, id: unknown, label: unknown) => {
    assertTrustedMainWindow(event)
    return result(() => {
      if (!isKeyId(id) || typeof label !== 'string') throw new Error('Invalid API key')
      renameApiKey(id, label)
    })
  })

  ipcMain.handle(API_KEYS_IPC.SET_MANAGER, (event, id: unknown) => {
    assertTrustedMainWindow(event)
    return result(() => {
      if (id !== null && !isKeyId(id)) throw new Error('Invalid API key')
      setManagerApiKey(id)
    })
  })

  ipcMain.handle(API_KEYS_IPC.TEST, async (event, id: unknown) => {
    assertTrustedMainWindow(event)
    if (!isKeyId(id)) return { ok: false, error: 'Invalid API key' }
    return testApiKey(id)
  })

  ipcMain.handle(API_KEYS_IPC.CONNECT_CLI, (event, payload: unknown) => {
    assertTrustedMainWindow(event)
    const request = payload as { keyId?: unknown; accountId?: unknown } | null
    if (!request || !isKeyId(request.keyId) || typeof request.accountId !== 'string' ||
      !request.accountId || request.accountId.length > 200) {
      return { ok: false, ready: false, error: 'Invalid request' }
    }
    const record = findApiKey(request.keyId)
    if (!record) return { ok: false, ready: false, error: 'This API key was removed' }
    const kind = API_KEY_PROVIDER_CLI[record.provider]
    ptyManager.killForAccount(kind, request.accountId)
    return connectApiKeyProfile(kind, request.accountId, request.keyId)
  })
}
