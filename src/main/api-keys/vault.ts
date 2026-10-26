import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  API_KEY_PROVIDERS,
  MANAGER_API_KEY_PROVIDERS,
  apiKeyHint,
  looksLikeProviderKey,
  type ApiKeyAddRequest,
  type ApiKeyProvider,
  type ApiKeyRecord,
  type ApiKeyTestResult
} from '@shared/contracts/api-keys'

/**
 * Encrypted store for provider API keys. Metadata lives in index.json; each
 * secret is encrypted with the OS keychain (Electron safeStorage) in its own
 * file and is only decrypted in the main process when a CLI or the Manager
 * needs it.
 */

const TEST_TIMEOUT_MS = 15_000

function vaultDir(): string {
  return join(app.getPath('userData'), 'api-keys')
}

function indexPath(): string {
  return join(vaultDir(), 'index.json')
}

function secretPath(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid API key id')
  return join(vaultDir(), `${id}.key`)
}

function writeAtomic(path: string, data: string | Buffer): void {
  mkdirSync(vaultDir(), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, data, { mode: 0o600 })
  renameSync(temporary, path)
}

function isRecord(value: unknown): value is ApiKeyRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as ApiKeyRecord
  return (
    typeof record.id === 'string' &&
    API_KEY_PROVIDERS.includes(record.provider) &&
    typeof record.label === 'string' &&
    typeof record.hint === 'string' &&
    typeof record.createdAt === 'number'
  )
}

function readIndex(): ApiKeyRecord[] {
  try {
    if (!existsSync(indexPath())) return []
    const raw = JSON.parse(readFileSync(indexPath(), 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw.filter(isRecord).map((record) => ({
      ...record,
      useForManager: record.useForManager === true,
      lastTestedAt: typeof record.lastTestedAt === 'number' ? record.lastTestedAt : null,
      lastTestOk: typeof record.lastTestOk === 'boolean' ? record.lastTestOk : null
    }))
  } catch {
    return []
  }
}

function writeIndex(records: ApiKeyRecord[]): void {
  writeAtomic(indexPath(), JSON.stringify(records, null, 2))
}

function assertEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure local credential encryption is not available on this computer')
  }
}

function cleanLabel(label: string, provider: ApiKeyProvider): string {
  const trimmed = label.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80)
  return trimmed || `${provider} key`
}

export function listApiKeys(): ApiKeyRecord[] {
  return readIndex()
}

export function findApiKey(id: string): ApiKeyRecord | undefined {
  return readIndex().find((record) => record.id === id)
}

export function readApiKeySecret(id: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const path = secretPath(id)
    if (!existsSync(path)) return null
    const value = safeStorage.decryptString(readFileSync(path)).trim()
    return value || null
  } catch {
    return null
  }
}

export function addApiKey(request: ApiKeyAddRequest): ApiKeyRecord {
  assertEncryption()
  if (!API_KEY_PROVIDERS.includes(request.provider)) throw new Error('Unknown API key provider')
  const secret = typeof request.secret === 'string' ? request.secret.trim() : ''
  if (!looksLikeProviderKey(request.provider, secret)) {
    throw new Error(
      request.provider === 'anthropic' && secret.startsWith('sk-ant-admin')
        ? 'This is an Admin key. Add a regular Anthropic API key here.'
        : 'This does not look like a valid key for the selected provider.'
    )
  }
  const records = readIndex()
  // Adding the same key twice (for example re-entering it in Manager settings) reuses the entry.
  const duplicate = records.find(
    (item) => item.provider === request.provider && item.hint === apiKeyHint(secret) && readApiKeySecret(item.id) === secret
  )
  if (duplicate) {
    if (request.useForManager) setManagerApiKey(duplicate.id)
    return findApiKey(duplicate.id) ?? duplicate
  }
  const record: ApiKeyRecord = {
    id: randomUUID(),
    provider: request.provider,
    label: cleanLabel(request.label, request.provider),
    hint: apiKeyHint(secret),
    createdAt: Date.now(),
    useForManager: false,
    lastTestedAt: null,
    lastTestOk: null
  }
  writeAtomic(secretPath(record.id), safeStorage.encryptString(secret))
  writeIndex([...records, record])
  if (request.useForManager) setManagerApiKey(record.id)
  return findApiKey(record.id) ?? record
}

export function removeApiKey(id: string): void {
  const records = readIndex()
  if (!records.some((record) => record.id === id)) return
  writeIndex(records.filter((record) => record.id !== id))
  rmSync(secretPath(id), { force: true })
}

export function renameApiKey(id: string, label: string): void {
  const records = readIndex()
  const record = records.find((item) => item.id === id)
  if (!record) throw new Error('This API key was removed')
  writeIndex(records.map((item) => (item.id === id ? { ...item, label: cleanLabel(label, item.provider) } : item)))
}

/** Marks one key as the Manager's key, or clears the choice with null. */
export function setManagerApiKey(id: string | null): void {
  const records = readIndex()
  if (id !== null) {
    const record = records.find((item) => item.id === id)
    if (!record) throw new Error('This API key was removed')
    if (!MANAGER_API_KEY_PROVIDERS.includes(record.provider)) {
      throw new Error('The Manager uses OpenAI. Choose an OpenAI key.')
    }
  }
  writeIndex(records.map((item) => ({ ...item, useForManager: item.id === id })))
}

export function managerApiKeyRecord(): ApiKeyRecord | undefined {
  return readIndex().find((record) => record.useForManager)
}

export function readManagerApiKey(): string | null {
  const record = managerApiKeyRecord()
  return record ? readApiKeySecret(record.id) : null
}

function testRequest(provider: ApiKeyProvider, secret: string): { url: string; headers: Record<string, string> } {
  if (provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/models?limit=1',
      headers: { 'x-api-key': secret, 'anthropic-version': '2023-06-01' }
    }
  }
  if (provider === 'openai') {
    return { url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${secret}` } }
  }
  // Header, not the ?key= query form, so the key never appears in a URL.
  return {
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    headers: { 'x-goog-api-key': secret }
  }
}

/** Makes a free metadata request (list models) to check that the provider accepts the key. */
export async function testApiKey(
  id: string,
  fetcher: typeof fetch = fetch
): Promise<ApiKeyTestResult> {
  const record = findApiKey(id)
  const secret = record ? readApiKeySecret(id) : null
  if (!record || !secret) return { ok: false, error: 'This API key could not be read. Add it again.' }
  const { url, headers } = testRequest(record.provider, secret)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
  let result: ApiKeyTestResult
  try {
    const response = await fetcher(url, { headers, signal: controller.signal })
    if (response.ok) result = { ok: true }
    else if (response.status === 401 || response.status === 403) {
      result = { ok: false, error: 'The provider rejected this key. It may be revoked or mistyped.' }
    } else if (response.status === 429) {
      result = { ok: false, error: 'The key works, but the provider is rate limiting it or the account is out of credit.' }
    } else {
      result = { ok: false, error: `The provider answered with HTTP ${response.status}. Try again later.` }
    }
  } catch {
    result = {
      ok: false,
      error: controller.signal.aborted ? 'The provider did not answer in time.' : 'Could not reach the provider.'
    }
  } finally {
    clearTimeout(timer)
  }
  writeIndex(
    readIndex().map((item) =>
      item.id === id ? { ...item, lastTestedAt: Date.now(), lastTestOk: result.ok } : item
    )
  )
  return result
}
