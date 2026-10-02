import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const sandbox = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => sandbox.root }, safeStorage: {} }))
vi.mock('os', async () => ({ ...await vi.importActual<typeof import('os')>('os'), homedir: () => sandbox.root }))
vi.mock('../cursor-profile', () => ({}))
vi.mock('../windows-credential', () => ({}))
vi.mock('../antigravity-credential', () => ({}))
vi.mock('../antigravity-logout', () => ({}))
import { getAuthProfileRoot, prepareAuthProfileLaunch } from '../profile-manager'

beforeEach(() => { sandbox.root = mkdtempSync(join(tmpdir(), 'bikorch-login-resume-')) })
afterEach(() => { rmSync(sandbox.root, { recursive: true, force: true }) })

describe('managed account login resume', () => {
  it.each(['codex', 'gemini', 'claude'] as const)('preserves partial %s credentials on retry', async (kind) => {
    const request = { kind, accountId: 'pending' }
    const root = getAuthProfileRoot(kind, request.accountId)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'pending-login'), 'browser login in progress')
    expect((await prepareAuthProfileLaunch(request, 'login', true)).ok).toBe(true)
    expect(readFileSync(join(root, 'pending-login'), 'utf8')).toBe('browser login in progress')
    expect((await prepareAuthProfileLaunch(request, 'login')).ok).toBe(true)
    expect(existsSync(join(root, 'pending-login'))).toBe(false)
  })
  it('retains completed credentials when a login is resumed after a restart', async () => {
    const request = { kind: 'codex' as const, accountId: 'completed' }
    const root = getAuthProfileRoot('codex', request.accountId)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: { access_token: 'fixture-token' } }))
    expect(await prepareAuthProfileLaunch(request, 'login', true)).toMatchObject({ ok: true, ready: true })
    expect(existsSync(join(root, 'auth.json'))).toBe(true)
  })
})
