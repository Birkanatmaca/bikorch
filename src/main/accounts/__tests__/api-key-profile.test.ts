import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
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
vi.mock('os', async () => ({ ...await vi.importActual<typeof import('os')>('os'), homedir: () => sandbox.root }))
vi.mock('../cursor-profile', () => ({}))
vi.mock('../windows-credential', () => ({}))
vi.mock('../antigravity-credential', () => ({}))
vi.mock('../antigravity-logout', () => ({}))
import { addApiKey } from '../../api-keys/vault'
import {
  apiKeyInUseByCli,
  connectApiKeyProfile,
  getAuthProfileEnv,
  getAuthProfileRoot,
  inspectAuthProfile,
  logoutAuthProfile
} from '../profile-manager'

const ANTHROPIC = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'
const OPENAI = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123'

beforeEach(() => { sandbox.root = mkdtempSync(join(tmpdir(), 'bikorch-key-profile-')) })
afterEach(() => rmSync(sandbox.root, { recursive: true, force: true }))

describe('API key accounts', () => {
  it('gives Claude the key through its own environment and pre-approves it', () => {
    const key = addApiKey({ provider: 'anthropic', label: 'Work', secret: ANTHROPIC })
    expect(connectApiKeyProfile('claude', 'acct-1', key.id)).toMatchObject({ ok: true, ready: true })
    const env = getAuthProfileEnv('claude', 'acct-1')
    expect(env.ANTHROPIC_API_KEY).toBe(ANTHROPIC)
    expect(env.CLAUDE_CONFIG_DIR).toBe(getAuthProfileRoot('claude', 'acct-1'))
    const config = JSON.parse(readFileSync(join(getAuthProfileRoot('claude', 'acct-1'), '.claude.json'), 'utf8'))
    expect(config.customApiKeyResponses.approved).toEqual([ANTHROPIC.slice(-20)])
    expect(inspectAuthProfile({ kind: 'claude', accountId: 'acct-1' })).toMatchObject({ ready: true, identity: { name: 'Work' } })
    expect(apiKeyInUseByCli(key.id)).toBe(true)
  })

  it('keeps other accounts free of the key', () => {
    const key = addApiKey({ provider: 'anthropic', label: 'Work', secret: ANTHROPIC })
    connectApiKeyProfile('claude', 'acct-1', key.id)
    expect(getAuthProfileEnv('claude', 'acct-2').ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('writes the Codex API key login file', () => {
    const key = addApiKey({ provider: 'openai', label: 'O', secret: OPENAI })
    expect(connectApiKeyProfile('codex', 'acct-c', key.id).ok).toBe(true)
    const auth = JSON.parse(readFileSync(join(getAuthProfileRoot('codex', 'acct-c'), 'auth.json'), 'utf8'))
    expect(auth.OPENAI_API_KEY).toBe(OPENAI)
  })

  it('refuses a key from another provider', () => {
    const key = addApiKey({ provider: 'openai', label: 'O', secret: OPENAI })
    expect(connectApiKeyProfile('claude', 'acct-1', key.id).ok).toBe(false)
  })

  it('signs out by dropping the binding while the key stays saved', async () => {
    const key = addApiKey({ provider: 'anthropic', label: 'Work', secret: ANTHROPIC })
    connectApiKeyProfile('claude', 'acct-1', key.id)
    await logoutAuthProfile({ kind: 'claude', accountId: 'acct-1' })
    expect(getAuthProfileEnv('claude', 'acct-1').ANTHROPIC_API_KEY).toBeUndefined()
    expect(apiKeyInUseByCli(key.id)).toBe(false)
    expect(existsSync(join(sandbox.root, 'api-keys', `${key.id}.key`))).toBe(true)
  })
})
