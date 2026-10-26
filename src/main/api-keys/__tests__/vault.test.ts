import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sandbox = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => sandbox.root },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^enc:/, '')
  }
}))
import {
  addApiKey,
  listApiKeys,
  readApiKeySecret,
  readManagerApiKey,
  removeApiKey,
  setManagerApiKey,
  testApiKey
} from '../vault'

const ANTHROPIC = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'
const OPENAI = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123'

beforeEach(() => { sandbox.root = mkdtempSync(join(tmpdir(), 'bikorch-vault-')) })
afterEach(() => rmSync(sandbox.root, { recursive: true, force: true }))

describe('API key vault', () => {
  it('stores the secret encrypted and exposes only a hint', () => {
    const record = addApiKey({ provider: 'anthropic', label: 'Work', secret: ANTHROPIC })
    expect(record.hint).toBe('0123')
    expect(JSON.stringify(listApiKeys())).not.toContain(ANTHROPIC)
    const files = readdirSync(join(sandbox.root, 'api-keys'))
    expect(files).toContain(`${record.id}.key`)
    expect(readFileSync(join(sandbox.root, 'api-keys', `${record.id}.key`), 'utf8')).toBe(`enc:${ANTHROPIC}`)
    expect(readApiKeySecret(record.id)).toBe(ANTHROPIC)
  })

  it('rejects admin keys and keys for the wrong provider', () => {
    expect(() => addApiKey({ provider: 'anthropic', label: '', secret: 'sk-ant-admin01-abcdefghijklmnopqrstuvwxyz' })).toThrow(/Admin key/)
    expect(() => addApiKey({ provider: 'openai', label: '', secret: ANTHROPIC })).toThrow()
  })

  it('reuses an entry when the same key is added again', () => {
    const first = addApiKey({ provider: 'openai', label: 'A', secret: OPENAI })
    const second = addApiKey({ provider: 'openai', label: 'B', secret: OPENAI, useForManager: true })
    expect(second.id).toBe(first.id)
    expect(listApiKeys()).toHaveLength(1)
    expect(listApiKeys()[0].useForManager).toBe(true)
  })

  it('keeps a single Manager key and only accepts OpenAI keys for it', () => {
    const anthropic = addApiKey({ provider: 'anthropic', label: 'A', secret: ANTHROPIC })
    const openai = addApiKey({ provider: 'openai', label: 'O', secret: OPENAI })
    expect(() => setManagerApiKey(anthropic.id)).toThrow(/OpenAI/)
    setManagerApiKey(openai.id)
    expect(readManagerApiKey()).toBe(OPENAI)
    setManagerApiKey(null)
    expect(readManagerApiKey()).toBeNull()
  })

  it('deletes the encrypted secret on removal', () => {
    const record = addApiKey({ provider: 'openai', label: 'O', secret: OPENAI, useForManager: true })
    removeApiKey(record.id)
    expect(listApiKeys()).toEqual([])
    expect(existsSync(join(sandbox.root, 'api-keys', `${record.id}.key`))).toBe(false)
    expect(readManagerApiKey()).toBeNull()
  })

  it('tests a key with a header, never a URL parameter, and records the result', async () => {
    const record = addApiKey({ provider: 'gemini', label: 'G', secret: 'AIzaSyabcdefghijklmnopqrstuvwxyz012' })
    const fetcher = vi.fn(async () => new Response('{}', { status: 401 }))
    const result = await testApiKey(record.id, fetcher as unknown as typeof fetch)
    expect(result.ok).toBe(false)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toContain('AIza')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toContain('AIza')
    expect(listApiKeys()[0].lastTestOk).toBe(false)
  })
})
