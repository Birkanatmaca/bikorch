import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const sandbox = vi.hoisted(() => ({ home: '', root: '', secret: null as string | null }))

vi.mock('electron', () => ({
  app: { getPath: () => sandbox.root },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => sandbox.home }
})

vi.mock('../windows-credential', () => ({
  readAntigravityCredential: vi.fn(async () => sandbox.secret),
  writeAntigravityCredential: vi.fn(async (value: string) => {
    sandbox.secret = value
  }),
  deleteAntigravityCredential: vi.fn(async () => {
    sandbox.secret = null
  })
}))

vi.mock('../antigravity-logout', () => ({
  logoutAntigravityCli: vi.fn(async () => {
    sandbox.secret = null
  })
}))

import {
  applyAntigravityCredentialsForAccount,
  captureAntigravityCredentialsForAccount,
  captureAntigravityLogin,
  finishAntigravityFreshLogin,
  hasStoredAntigravityCredentials,
  isAntigravityFreshLoginActive,
  markAntigravitySessionAccount,
  prepareAntigravityFreshLogin
} from '../antigravity-credential'

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

function seedSystemLogin(email: string): void {
  writeJson(join(sandbox.home, '.gemini', 'google_accounts.json'), { active: email, old: [] })
  writeFileSync(join(sandbox.home, '.gemini', 'oauth_creds.json'), '{"refresh":"saved"}')
  mkdirSync(join(sandbox.home, '.gemini', 'antigravity-cli'), { recursive: true })
  writeFileSync(join(sandbox.home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'), 'saved-token')
}

async function seedSavedAccount(accountId: string, email: string, secret: string): Promise<void> {
  sandbox.secret = secret
  seedSystemLogin(email)
  expect(await captureAntigravityCredentialsForAccount(accountId)).toBe(true)
  const root = join(sandbox.root, 'cli-profiles', 'antigravity')
  const dir = readdirSync(root)[0]
  writeJson(join(root, dir, 'profile.json'), { accountId, kind: 'antigravity', email })
}

function idToken(email: string): string {
  return `header.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.sig`
}

beforeEach(() => {
  sandbox.root = mkdtempSync(join(tmpdir(), 'bikorch-agy-login-'))
  sandbox.home = mkdtempSync(join(tmpdir(), 'bikorch-agy-home-'))
  sandbox.secret = null
  markAntigravitySessionAccount(null)
  finishAntigravityFreshLogin()
})

afterEach(() => {
  rmSync(sandbox.root, { recursive: true, force: true })
  rmSync(sandbox.home, { recursive: true, force: true })
})

describe('antigravity fresh login', () => {
  it('clears the system login without dropping the saved account', async () => {
    await seedSavedAccount('saved', 'saved@example.com', 'secret-saved')
    sandbox.secret = 'secret-saved'

    await prepareAntigravityFreshLogin('new')

    expect(sandbox.secret).toBeNull()
    expect(existsSync(join(sandbox.home, '.gemini', 'oauth_creds.json'))).toBe(false)
    expect(existsSync(join(sandbox.home, '.gemini', 'google_accounts.json'))).toBe(false)
    expect(existsSync(join(sandbox.home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'))).toBe(false)
    expect(hasStoredAntigravityCredentials('saved')).toBe(true)
  })

  it('rejects a sign-in that belongs to an account already saved', async () => {
    await seedSavedAccount('saved', 'saved@example.com', 'secret-saved')
    sandbox.secret = 'secret-saved'
    seedSystemLogin('saved@example.com')

    const result = await captureAntigravityLogin('new')

    expect(result.ready).toBe(false)
    expect(result.error).toMatch(/zaten kayıtlı/)
    expect(hasStoredAntigravityCredentials('new')).toBe(false)
  })

  it('stores a different Google account on the new card', async () => {
    await seedSavedAccount('saved', 'saved@example.com', 'secret-saved')
    sandbox.secret = 'secret-new'
    seedSystemLogin('new@example.com')

    const result = await captureAntigravityLogin('new')

    expect(result).toMatchObject({ ready: true, identity: { email: 'new@example.com', name: 'new@example.com' } })
    expect(hasStoredAntigravityCredentials('new')).toBe(true)
    expect(hasStoredAntigravityCredentials('saved')).toBe(true)
  })

  it('drops the browser profile and refuses to restore a saved account during sign-in', async () => {
    await seedSavedAccount('saved', 'saved@example.com', 'secret-saved')
    mkdirSync(join(sandbox.home, '.gemini', 'antigravity-browser-profile'), { recursive: true })
    writeFileSync(join(sandbox.home, '.gemini', 'antigravity-browser-profile', 'Cookies'), 'session')

    await prepareAntigravityFreshLogin('new')

    expect(isAntigravityFreshLoginActive()).toBe(true)
    expect(existsSync(join(sandbox.home, '.gemini', 'antigravity-browser-profile'))).toBe(false)
    expect(await applyAntigravityCredentialsForAccount('saved')).toBe(false)
    expect(sandbox.secret).toBeNull()
  })

  it('rejects the account named in the CLI token even when google_accounts differs', async () => {
    await seedSavedAccount('saved', 'saved@example.com', 'secret-saved')
    sandbox.secret = 'secret-other'
    writeJson(join(sandbox.home, '.gemini', 'google_accounts.json'), {
      active: 'other@example.com',
      old: []
    })
    writeFileSync(
      join(sandbox.home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
      JSON.stringify({ id_token: idToken('saved@example.com') })
    )

    const result = await captureAntigravityLogin('new')

    expect(result.ready).toBe(false)
    expect(result.error).toMatch(/zaten kayıtlı/)
    expect(hasStoredAntigravityCredentials('new')).toBe(false)
  })
})
